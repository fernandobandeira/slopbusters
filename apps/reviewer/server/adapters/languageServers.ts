import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { languageServerConfigurationSchema } from '../../shared/api/settings'
export { languageServerConfigurationSchema } from '../../shared/api/settings'
import { languageExtensions, sourceLanguage } from '../../shared/domain/languages'
import type {
  LanguageServerConfig,
  LanguageServerStatus,
} from '../../shared/domain/languageServers'

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

export function defaultLanguageServers(): LanguageServerConfig[] {
  return Object.entries(commands).map(([language, [command, args]]) => ({
    language,
    command,
    args: [...args],
    extensions: [
      ...(Object.entries(languageExtensions).find(([key]) => key === language)?.[1] ?? []),
    ],
  }))
}

/** Inspect PATH without starting a server or executing a repository-provided command. */
export async function findExecutable(command: string): Promise<string | undefined> {
  if (!command) return undefined
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes('/') || command.includes('\\')
      ? []
      : (process.env.PATH ?? '')
          .split(delimiter)
          .filter(isAbsolute)
          .flatMap((directory) =>
            process.platform === 'win32'
              ? ['', '.exe', '.cmd', '.bat'].map((suffix) => join(directory, command + suffix))
              : [join(directory, command)],
          )
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      /* Try the next PATH directory. */
    }
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
      this.configuration = languageServerConfigurationSchema.parse(
        JSON.parse(await readFile(join(this.dataDirectory, 'language-servers.json'), 'utf8')),
      )
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
    return Promise.all(
      (await this.list()).map(async (server) => {
        const executable = await findExecutable(server.command)
        return {
          ...server,
          available: Boolean(executable),
          detail: executable
            ? 'Available'
            : server.command
              ? `Install ${server.command} or set its absolute path.`
              : 'Set a stdio language-server command to enable semantic navigation.',
        }
      }),
    )
  }

  async forPath(path: string) {
    const extension = path.split('.').at(-1)?.toLowerCase()
    const server = (await this.list()).find((candidate) =>
      candidate.extensions.includes(extension ?? ''),
    )
    return { language: server?.language ?? sourceLanguage(path), server }
  }
}
