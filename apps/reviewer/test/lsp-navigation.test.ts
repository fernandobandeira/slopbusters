import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageServers, defaultLanguageServers, languageServerConfigurationSchema } from '../server/languageServers'
import { LanguageServerNavigation } from '../server/lspNavigation'
import { languageServerTargets, startLanguageServer } from '../server/lspClient'
import { createSourceWorkspace, workspacePath, type SourceWorkspace } from '../server/sourceWorkspace'
import { createSourceNavigator } from '../server/navigation'
import { DiffSide } from '../shared/types'
import type { LanguageServerConfig } from '../shared/languageServers'
import { fixturePull } from './fixtures/pull'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })
const fixture = fileURLToPath(new URL('./fixtures/language-server.mjs', import.meta.url))
const selection = { side: DiffSide.right, path: 'use.go', line: 1, column: 4, kind: 'definition' as const }
function project(contents: Record<string, string>) {
  return {
    tree: vi.fn(async (pull, side) => ({ sha: side === DiffSide.left ? pull.mergeBaseSha : pull.headSha, paths: Object.keys(contents), warnings: [] })),
    file: vi.fn(async (_pull, _side, path: string) => ({ path, sha: 'revision', content: contents[path], symbols: [] })),
  }
}
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'slopbusters-lsp-test-'))
  cleanups.push(() => rm(value, { recursive: true, force: true }))
  return value
}
function config(language: string, extension: string): LanguageServerConfig {
  return { language, extensions: [extension], command: process.execPath, args: [fixture] }
}

describe('installed language-server navigation', () => {
  it.each([['go', 'go'], ['rust', 'rs'], ['python', 'py'], ['java', 'java'], ['c_sharp', 'cs'], ['cpp', 'cpp'], ['ruby', 'rb'], ['php', 'php'], ['bash', 'sh'], ['powershell', 'ps1'], ['custom', 'custom']])(
    'opens exact-revision %s source and maps LocationLink results and negotiated UTF-8 positions', async (language, extension) => {
      const server = config(language, extension)
      const request = { ...selection, path: `use.${extension}` }
      const loader = project({ [request.path]: '😀 run()', [`service.${extension}`]: '😀 run declaration' })
      const workspace = await createSourceWorkspace(loader, fixturePull(), request, server)
      cleanups.push(workspace.close)
      const session = await startLanguageServer(server, process.execPath, workspace)
      cleanups.push(session.close)
      const result = await session.navigate(request)
      expect(result.mode).toBe('semantic')
      expect(result.targets).toEqual([{ path: `service.${extension}`, name: 'run', line: 1, column: 4, endLine: 1, endColumn: 7 }])
      expect(result.warnings.join(' ')).toContain('outside this saved source snapshot')
      const record = JSON.parse(await readFile(join(workspace.root, 'client-record.json'), 'utf8'))
      expect(record.request.position).toEqual({ line: 0, character: 5 })
      expect(record.document.text).toBe('😀 run()')
      expect(record.initialization.capabilities.general.positionEncodings).toContain('utf-16')
      if (language === 'rust') expect(record.initialization.initializationOptions).toMatchObject({ cargo: { buildScripts: { enable: false }, noDeps: true }, procMacro: { enable: false }, checkOnSave: false })
      if (language === 'go') expect(record.settings[0].env).toMatchObject({ GOPROXY: 'off', GOTOOLCHAIN: 'local' })
      const refs = await session.navigate({ ...request, kind: 'references' })
      expect(refs.targets).toEqual(result.targets)
      const refsRecord = JSON.parse(await readFile(join(workspace.root, 'client-record.json'), 'utf8'))
      expect(refsRecord.request.context).toEqual({ includeDeclaration: true })
      await session.close()
      await expect(access(workspace.directory)).rejects.toThrow()
    },
  )

  it('reuses a revision session while keeping head, merge base and repository identities separate', async () => {
    const servers = new LanguageServers(await directory())
    await servers.save([config('go', 'go')])
    const loader = project({ 'use.go': '😀 run()', 'service.go': '😀 run declaration' })
    const navigation = new LanguageServerNavigation(loader, servers)
    cleanups.push(() => navigation.close())
    const pull = { ...fixturePull(), mergeBaseSha: 'merge-base' }
    const first = await navigation.navigate(pull, selection)
    expect(first?.mode).toBe('semantic')
    await navigation.navigate(pull, { ...selection, kind: 'references' })
    expect(loader.file).toHaveBeenCalledTimes(2)
    await navigation.navigate(pull, { ...selection, side: DiffSide.left })
    expect(loader.file).toHaveBeenCalledTimes(4)
    await navigation.navigate({ ...pull, headSha: 'new-head' }, selection)
    expect(loader.file).toHaveBeenCalledTimes(6)
    expect(new Set(loader.file.mock.calls.map((call) => call[1]))).toEqual(new Set([DiffSide.left, DiffSide.right]))
    await navigation.navigate({ ...pull, owner: 'another-owner' }, selection)
    expect(loader.file).toHaveBeenCalledTimes(8)
  })

  it('labels unavailable servers and retries after local configuration changes instead of caching fallback results', async () => {
    const servers = new LanguageServers(await directory())
    await servers.save([{ ...config('go', 'go'), command: 'slopbusters-server-does-not-exist' }])
    const loader = project({ 'use.go': '😀 run()', 'service.go': '😀 run declaration' })
    const languageNavigation = new LanguageServerNavigation(loader, servers)
    cleanups.push(() => languageNavigation.close())
    const navigate = createSourceNavigator(loader, languageNavigation)
    const missing = await navigate(fixturePull(), selection)
    expect(missing.mode).toBe('text')
    expect(missing.warnings.join(' ')).toContain('unavailable')
    await servers.save([config('go', 'go')])
    const semantic = await navigate(fixturePull(), selection)
    expect(semantic.mode).toBe('semantic')
    expect(semantic.targets[0].path).toBe('service.go')
  })

  it('rejects duplicate or reserved extensions and persists arbitrary additional languages', async () => {
    const dataDirectory = await directory()
    const servers = new LanguageServers(dataDirectory)
    const custom = config('elixir', 'ex')
    await servers.save([custom])
    expect(await new LanguageServers(dataDirectory).list()).toEqual([custom])
    expect((await servers.forPath('lib/server.ex')).language).toBe('elixir')
    expect(languageServerConfigurationSchema.safeParse([custom, custom]).success).toBe(false)
    expect(languageServerConfigurationSchema.safeParse([{ ...custom, extensions: ['ts'] }]).success).toBe(false)
    expect(defaultLanguageServers().map((server) => server.language)).toEqual(expect.arrayContaining(['go', 'rust', 'python', 'java', 'c_sharp', 'c', 'cpp', 'ruby', 'php', 'bash', 'powershell']))
  })

  it('reports malformed and out-of-file server locations instead of exposing arbitrary filesystem content', async () => {
    const workspace: SourceWorkspace = { directory: '/review', root: '/review', files: new Map([['a.py', '😀 run\r\n']]), warnings: [], close: async () => {} }
    const warnings = new Set<string>()
    const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 6 } }
    expect(languageServerTargets([{ uri: pathToFileURL('/review/a.py').href, range }], workspace, 'utf-16', warnings)).toMatchObject([{ name: 'run', column: 4 }])
    expect(languageServerTargets([{ uri: pathToFileURL('/review/a.py').href, range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } } }], workspace, 'utf-32', warnings)).toMatchObject([{ name: 'run', column: 4 }])
    expect(languageServerTargets([{ uri: 'file:///review/a.py', range: { start: { line: 0, character: 99 }, end: { line: 0, character: 100 } } }, { invalid: true }], workspace, 'utf-16', warnings)).toEqual([])
    expect(warnings.size).toBe(2)
  })

  it('prevents path traversal and omits repository executable/tool configuration from snapshots', async () => {
    for (const path of ['../escape', '/absolute', 'directory/../../escape', 'windows\\escape', '.'])
      expect(() => workspacePath('/review', path)).toThrow()
    const loader = project({ 'src/lib.rs': 'pub fn run() {}', 'Cargo.toml': '[package]\nname="example"', '.cargo/config.toml': 'malicious configuration', 'build.rs': 'fn main() {}' })
    const workspace = await createSourceWorkspace(loader, fixturePull(), { ...selection, path: 'src/lib.rs', column: 1 }, config('rust', 'rs'))
    cleanups.push(workspace.close)
    expect(workspace.files.has('Cargo.toml')).toBe(true)
    expect(workspace.files.has('.cargo/config.toml')).toBe(false)
    await expect(access(join(workspace.directory, '.cargo/config.toml'))).rejects.toThrow()
  })
})
