import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { languageExtensions, sourceLanguage } from '../shared/languages'
import type { LanguageServerConfig, LanguageServerStatus } from '../shared/languageServers'

const commands: Record<string, [string, string[]]> = {
  go: ['gopls', []],
  rust: ['rust-analyzer', []],
  python: ['pyright-langserver', ['--stdio']],
  c: ['clangd', ['--enable-config=false', '--background-index=false', '--clang-tidy=false']],
  cpp: ['clangd', ['--enable-config=false', '--background-index=false', '--clang-tidy=false']],
  java: ['jdtls', []],
  c_sharp: ['omnisharp', ['--languageserver', '--stdio']],
  ruby: ['solargraph', ['stdio']],
  php: ['intelephense', ['--stdio']],
  bash: ['bash-language-server', ['start']],
  // Editor Services needs a local launcher with its installation path and -Stdio.
  powershell: ['', []],
  lua: ['lua-language-server', []],
  kotlin: ['kotlin-language-server', []],
  swift: ['sourcekit-lsp', []],
  dart: ['dart', ['language-server', '--protocol=lsp']],
  html: ['vscode-html-language-server', ['--stdio']],
  css: ['vscode-css-language-server', ['--stdio']],
  json: ['vscode-json-language-server', ['--stdio']],
  yaml: ['yaml-language-server', ['--stdio']],
}

export const languageServerConfigurationSchema = z.array(z.object({
  language: z.string().regex(/^[a-z][a-z0-9_+-]*$/).max(80),
  extensions: z.array(z.string().regex(/^[a-z0-9]+$/).max(30)).min(1).max(30),
  command: z.string().max(2000).refine((value) => !/[\r\n\0]/.test(value)),
  args: z.array(z.string().max(4000).refine((value) => !value.includes('\0'))).max(50),
}).strict()).max(60).superRefine((servers, context) => {
  const languages = new Set<string>()
  const extensions = new Set<string>()
  for (const server of servers) {
    if (['typescript', 'javascript'].includes(server.language) || languages.has(server.language))
      context.addIssue({ code: 'custom', message: 'Language IDs must be unique; JavaScript and TypeScript are bundled.' })
    languages.add(server.language)
    for (const extension of server.extensions) {
      if (extensions.has(extension) || [...languageExtensions.typescript, ...languageExtensions.javascript].includes(extension))
        context.addIssue({ code: 'custom', message: 'Each extension must belong to one server.' })
      extensions.add(extension)
    }
  }
})

export function defaultLanguageServers(): LanguageServerConfig[] {
  return Object.entries(commands).map(([language, [command, args]]) => ({
    language, command, args: [...args], extensions: [...languageExtensions[language]],
  }))
}

/** Inspect PATH without starting a server or executing a repository-provided command. */
export async function findExecutable(command: string): Promise<string | undefined> {
  if (!command) return undefined
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes('/') || command.includes('\\')
      ? []
      : (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).flatMap((directory) =>
          process.platform === 'win32'
            ? ['', '.exe', '.cmd', '.bat'].map((suffix) => join(directory, command + suffix))
            : [join(directory, command)],
        )
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch { /* Try the next PATH directory. */ }
  }
  return undefined
}

export class LanguageServers {
  private configuration = defaultLanguageServers()
  private loaded?: Promise<void>
  constructor(private readonly dataDirectory: string) {}

  async list(): Promise<LanguageServerConfig[]> {
    this.loaded ??= this.load()
    await this.loaded
    return structuredClone(this.configuration)
  }

  private async load() {
    try {
      this.configuration = languageServerConfigurationSchema.parse(JSON.parse(
        await readFile(join(this.dataDirectory, 'language-servers.json'), 'utf8'),
      ))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  async save(value: unknown) {
    await this.list()
    const configuration = languageServerConfigurationSchema.parse(value)
    await mkdir(this.dataDirectory, { recursive: true })
    const temporary = join(this.dataDirectory, `language-servers-${randomUUID()}.json`)
    await writeFile(temporary, JSON.stringify(configuration, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, join(this.dataDirectory, 'language-servers.json'))
    this.configuration = configuration
  }

  async statuses(): Promise<LanguageServerStatus[]> {
    return Promise.all((await this.list()).map(async (server) => {
      const executable = await findExecutable(server.command)
      return {
        ...server, available: Boolean(executable),
        detail: executable ? 'Available' : server.command ? `Install ${server.command} or set its absolute path.` : 'Set a stdio language-server command to enable semantic navigation.',
      }
    }))
  }

  async forPath(path: string) {
    const extension = path.split('.').at(-1)?.toLowerCase()
    const server = (await this.list()).find((candidate) => candidate.extensions.includes(extension ?? ''))
    return { language: server?.language ?? sourceLanguage(path), server }
  }
}
