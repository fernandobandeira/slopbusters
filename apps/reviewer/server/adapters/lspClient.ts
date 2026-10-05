import { MAX_NAVIGATION_TARGETS } from '../limits'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import {
  CancellationTokenSource,
  createMessageConnection,
  ResponseError,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js'
import type { LanguageServerConfig } from '../../shared/domain/languageServers'
import type {
  NavigationRequest,
  NavigationResult,
  NavigationTarget,
} from '../../shared/domain/navigation'
import { workspacePath, type SourceWorkspace } from './sourceWorkspace'

const positionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
})
const rangeSchema = z.object({ start: positionSchema, end: positionSchema })
const locationSchema = z.union([
  z.object({ uri: z.string(), range: rangeSchema }),
  z.object({ targetUri: z.string(), targetSelectionRange: rangeSchema }),
])
type Encoding = 'utf-16' | 'utf-8' | 'utf-32'

function serverSettings(language: string, root: string): Record<string, unknown> {
  if (language === 'rust')
    return {
      cargo: { buildScripts: { enable: false }, noDeps: true, extraArgs: ['--offline'] },
      procMacro: { enable: false },
      checkOnSave: false,
    }
  if (language === 'go')
    return {
      env: { GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', CGO_ENABLED: '0' },
      analyses: {},
      staticcheck: false,
    }
  if (language === 'java')
    return {
      java: {
        autobuild: { enabled: false },
        import: { gradle: { enabled: false }, maven: { enabled: false } },
        configuration: { updateBuildConfiguration: 'disabled' },
      },
    }
  if (language === 'c_sharp')
    return {
      MSBuild: { EnablePackageAutoRestore: false },
      RoslynExtensionsOptions: { EnableAnalyzersSupport: false },
    }
  if (language === 'python')
    return {
      python: {
        analysis: {
          autoSearchPaths: true,
          diagnosticMode: 'openFilesOnly',
          typeCheckingMode: 'off',
        },
      },
    }
  if (language === 'ruby')
    return { solargraph: { diagnostics: false, formatting: false, useBundler: false } }
  if (language === 'lua')
    return {
      Lua: {
        workspace: { checkThirdParty: false, library: [] },
        runtime: { path: [`${root}/?.lua`, `${root}/?/init.lua`] },
      },
    }
  return {}
}

async function rpc<T>(
  connection: MessageConnection,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  const cancellation = new CancellationTokenSource()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      connection.sendRequest<T>(method, params, cancellation.token),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          cancellation.cancel()
          reject(new Error(`Language server timed out during ${method}.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
    cancellation.dispose()
  }
}

function encodedColumn(text: string, column: number, encoding: Encoding): number {
  const before = text.slice(0, column)
  return encoding === 'utf-8'
    ? Buffer.byteLength(before)
    : encoding === 'utf-32'
      ? [...before].length
      : column
}

function utf16Column(text: string, character: number, encoding: Encoding): number | undefined {
  if (encoding === 'utf-16') return character <= text.length ? character : undefined
  let units = 0
  let encoded = 0
  for (const point of text) {
    if (encoded === character) return units
    encoded += encoding === 'utf-8' ? Buffer.byteLength(point) : 1
    units += point.length
  }
  return encoded === character ? units : undefined
}

export function languageServerTargets(
  value: unknown,
  workspace: SourceWorkspace,
  encoding: Encoding,
  warnings: Set<string>,
): NavigationTarget[] {
  const locations = value == null ? [] : Array.isArray(value) ? value : [value]
  const targets = new Map<string, NavigationTarget>()
  for (const location of locations) {
    const parsed = locationSchema.safeParse(location)
    if (!parsed.success) {
      warnings.add('The language server returned an invalid source location.')
      continue
    }
    const result = parsed.data
    const uri = 'uri' in result ? result.uri : result.targetUri
    const range = 'range' in result ? result.range : result.targetSelectionRange
    let path: string
    try {
      path = relative(workspace.directory, fileURLToPath(uri))
      if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
        throw new Error('Outside snapshot')
      path = path.split(sep).join('/')
    } catch {
      warnings.add('Some locations are outside this saved source snapshot and cannot be opened.')
      continue
    }
    const content = workspace.files.get(path)
    if (content === undefined) {
      warnings.add('Some locations are outside this saved source snapshot and cannot be opened.')
      continue
    }
    const lines = content.split('\n').map((line) => line.replace(/\r$/, ''))
    const startLine = lines[range.start.line]
    const endLine = lines[range.end.line]
    const start =
      startLine === undefined ? undefined : utf16Column(startLine, range.start.character, encoding)
    const end =
      endLine === undefined ? undefined : utf16Column(endLine, range.end.character, encoding)
    if (
      startLine === undefined ||
      start === undefined ||
      end === undefined ||
      range.end.line < range.start.line ||
      (range.end.line === range.start.line && end < start)
    ) {
      warnings.add('The language server returned a location outside the saved file.')
      continue
    }
    const name =
      range.start.line === range.end.line ? startLine.slice(start, end) : startLine.slice(start)
    const target = {
      path,
      line: range.start.line + 1,
      column: start + 1,
      endLine: range.end.line + 1,
      endColumn: end + 1,
      name: name.slice(0, 200) || path,
    }
    targets.set(
      `${path}:${target.line}:${target.column}:${target.endLine}:${target.endColumn}`,
      target,
    )
    if (targets.size >= MAX_NAVIGATION_TARGETS) {
      warnings.add(
        `Semantic navigation is limited to ${MAX_NAVIGATION_TARGETS} locations; additional results may exist.`,
      )
      break
    }
  }
  return [...targets.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
  )
}

export async function startLanguageServer(
  server: LanguageServerConfig,
  executable: string,
  workspace: SourceWorkspace,
) {
  const args = [...server.args]
  if (server.language === 'java')
    args.push('-data', workspacePath(workspace.directory, '.jdtls-data'))
  const child = spawn(executable, args, {
    cwd: workspace.root,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GOPROXY: 'off',
      GOSUMDB: 'off',
      GOTOOLCHAIN: 'local',
      CGO_ENABLED: '0',
      CARGO_NET_OFFLINE: 'true',
      PYTHONPATH: '',
      PYTHONSAFEPATH: '1',
      PYTHONNOUSERSITE: '1',
    },
  })
  // Server diagnostics can contain source or local paths; do not expose raw stderr.
  child.stderr.resume()
  const connection = createMessageConnection(child.stdout, child.stdin)
  let processError: Error | undefined
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => {
      connection.dispose()
      resolve()
    })
  })
  child.once('error', (error) => {
    processError = error
    connection.dispose()
  })
  let closed = false
  let encoding: Encoding = 'utf-16'
  const providers = new Set<string>()
  let rustHealth = 'ok'
  let signalRustReady: () => void = () => {}
  const rustReady = new Promise<void>((resolve) => {
    signalRustReady = resolve
  })
  connection.onNotification(
    'experimental/serverStatus',
    (status: { health: string; quiescent: boolean }) => {
      rustHealth = status.health
      if (status.quiescent || status.health === 'error') signalRustReady()
    },
  )
  const settings = serverSettings(server.language, workspace.root)
  const namespaced = ['rust', 'go'].includes(server.language)
    ? { [server.language === 'rust' ? 'rust-analyzer' : 'gopls']: settings }
    : settings
  connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
    params.items.map(({ section }) => {
      if (!section) return namespaced
      let value: unknown = namespaced
      for (const key of section.split('.'))
        value =
          value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
      return value ?? null
    }),
  )
  connection.onRequest('workspace/workspaceFolders', () => [
    { uri: pathToFileURL(workspace.root).href, name: 'Review source' },
  ])
  connection.onRequest(
    'client/registerCapability',
    (params: { registrations: { method: string }[] }) => {
      for (const registration of params.registrations) providers.add(registration.method)
      return null
    },
  )
  connection.onRequest(
    'client/unregisterCapability',
    (params: { unregisterations: { method: string }[] }) => {
      for (const registration of params.unregisterations) providers.delete(registration.method)
      return null
    },
  )
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('workspace/applyEdit', () => ({
    applied: false,
    failureReason: 'Review sources are immutable.',
  }))
  connection.onRequest('window/showMessageRequest', () => null)
  connection.listen()
  async function close() {
    if (closed) return
    closed = true
    try {
      await rpc(connection, 'shutdown', null, 1000)
      await connection.sendNotification('exit')
    } catch {
      /* A failed or unavailable server still needs process and workspace cleanup. */
    }
    connection.dispose()
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        /* Already exited. */
      }
    }
    kill('SIGTERM')
    const force = setTimeout(() => {
      kill('SIGKILL')
    }, 1000)
    await exited
    clearTimeout(force)
    await workspace.close()
  }
  try {
    const initialize = await rpc<{
      capabilities: {
        definitionProvider?: unknown
        referencesProvider?: unknown
        implementationProvider?: unknown
        positionEncoding?: Encoding
      }
    }>(
      connection,
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'Slopbusters', version: '0.1.0' },
        rootUri: pathToFileURL(workspace.root).href,
        rootPath: workspace.root,
        workspaceFolders: [{ uri: pathToFileURL(workspace.root).href, name: 'Review source' }],
        capabilities: {
          general: { positionEncodings: ['utf-16', 'utf-8', 'utf-32'] },
          experimental: { serverStatusNotification: true },
          workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
          textDocument: {
            definition: { linkSupport: true, dynamicRegistration: true },
            references: { dynamicRegistration: true },
            implementation: { linkSupport: true, dynamicRegistration: true },
            synchronization: { didSave: false },
          },
        },
        initializationOptions: settings,
      },
      45_000,
    )
    const capabilities = initialize.capabilities
    if (capabilities.definitionProvider) providers.add('textDocument/definition')
    if (capabilities.referencesProvider) providers.add('textDocument/references')
    if (capabilities.implementationProvider) providers.add('textDocument/implementation')
    encoding = capabilities.positionEncoding ?? 'utf-16'
    if (!['utf-16', 'utf-8', 'utf-32'].includes(encoding))
      throw new Error('The language server uses an unsupported position encoding.')
    await connection.sendNotification('initialized', {})
    await connection.sendNotification('workspace/didChangeConfiguration', { settings: namespaced })
    const opened = new Set<string>()
    return {
      close,
      async navigate(request: NavigationRequest): Promise<NavigationResult> {
        if (closed) throw new Error('The language server session has closed.')
        const content = workspace.files.get(request.path)
        if (content === undefined)
          throw new Error('This file is not in the semantic source snapshot.')
        const uri = pathToFileURL(workspacePath(workspace.directory, request.path)).href
        if (!opened.has(uri)) {
          const languageId =
            server.language === 'c_sharp'
              ? 'csharp'
              : server.language === 'bash'
                ? 'shellscript'
                : server.language
          await connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content },
          })
          opened.add(uri)
        }
        const line = content.split('\n')[request.line - 1]?.replace(/\r$/, '')
        if (line === undefined || request.column < 1 || request.column > line.length + 1)
          throw new Error('The selected source position is outside this file.')
        const params = {
          textDocument: { uri },
          position: {
            line: request.line - 1,
            character: encodedColumn(line, request.column - 1, encoding),
          },
          ...(request.kind === 'references' ? { context: { includeDeclaration: true } } : {}),
        }
        if (
          server.language === 'rust' &&
          basename(executable).replace(/\.exe$/i, '') === 'rust-analyzer'
        ) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              rustReady,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                  reject(new Error('Rust project loading timed out.'))
                }, 45_000)
              }),
            ])
          } finally {
            clearTimeout(timer)
          }
          if (rustHealth === 'error')
            throw new Error('Rust project loading failed. Check cargo and rustc installation.')
        }
        const method = `textDocument/${request.kind}`
        if (!providers.has(method))
          throw new Error(`The installed ${server.command} does not support ${request.kind}.`)
        const warnings = new Set(workspace.warnings)
        const deadline = Date.now() + 25_000
        let value: unknown
        while (true) {
          try {
            value = await rpc<unknown>(
              connection,
              method,
              params,
              Math.max(1, deadline - Date.now()),
            )
            break
          } catch (error) {
            // Servers can cancel a request while their initial project index changes.
            if (
              !(error instanceof ResponseError) ||
              ![-32801, -32802].includes(error.code) ||
              Date.now() >= deadline
            )
              throw error
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
        }
        return {
          language: server.language,
          mode: 'semantic',
          targets: languageServerTargets(value, workspace, encoding, warnings),
          warnings: [...warnings],
        }
      },
    }
  } catch (error) {
    await close()
    throw processError ?? error
  }
}
