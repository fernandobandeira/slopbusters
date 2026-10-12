import { join } from 'node:path'
import type { ChatLocation } from '../../../shared/domain/chat'
import { logError, UserError } from '../../errors'
import { runCommand } from '../process'
import type { BundledEngine } from './bundledEngine'
import type { EngineConnection } from './engineConnection'
import { mintPairingToken } from './enginePairing'
import type { EngineProject, EngineThreadOperations } from './engineThreads'

/** How the chat window appears in the bundled engine's connections list. */
const CHAT_WINDOW_LABEL = 'Slopbusters chat window'

/** A T3 Code project ready to hold a chat, and how to show the user the thread it starts. */
export interface ChatWorkspace {
  readonly location: ChatLocation
  readonly threads: EngineThreadOperations
  readonly project: EngineProject
  open(threadId: string): Promise<void>
}

export interface ChatHosts {
  workspaceFor(repository: { owner: string; repo: string }): Promise<ChatWorkspace>
}

export interface UserEngineHost {
  readonly threads: EngineThreadOperations
  /** Bring T3 Code forward, where the new thread is at the top of the sidebar. */
  readonly reveal?: () => Promise<void>
}

export interface BundledEngineHost {
  readonly engine: Pick<BundledEngine, 'cli'>
  readonly connection: Pick<EngineConnection, 'locate'>
  readonly threads: EngineThreadOperations
  /** Where the bundled engine keeps the repositories it clones. */
  readonly home: string
  /** Show a page of the bundled engine's web app; the desktop app opens its own window. */
  readonly openUrl?: (url: string) => Promise<void>
  readonly mintToken?: typeof mintPairingToken
}

/**
 * Chats go to the user's T3 Code when it is running, speaks this build's protocol, and has a
 * project for the repository. Otherwise they run on the engine Slopbusters bundles, which clones
 * the repository the first time and shows the thread in a Slopbusters window.
 */
export class EngineChatHosts implements ChatHosts {
  private readonly clones = new Map<string, Promise<EngineProject>>()

  constructor(
    private readonly user: UserEngineHost,
    private readonly bundled?: BundledEngineHost,
  ) {}

  async workspaceFor(repository: { owner: string; repo: string }): Promise<ChatWorkspace> {
    const key = `github.com/${repository.owner}/${repository.repo}`.toLowerCase()
    const project = await this.userProject(key)
    if (project)
      return {
        location: 't3code',
        threads: this.user.threads,
        project,
        open: this.user.reveal ?? revealT3Code,
      }
    const bundled = this.bundled
    if (!bundled)
      throw new UserError(
        `Add your ${repository.owner}/${repository.repo} checkout as a project in T3 Code, then try again.`,
      )
    return {
      location: 'slopbusters',
      threads: bundled.threads,
      project: await this.bundledProject(bundled, repository, key),
      open: (threadId) => openBundledThread(bundled, threadId),
    }
  }

  /** The user's matching project, or undefined when their T3 Code cannot take the chat. */
  private async userProject(key: string): Promise<EngineProject | undefined> {
    try {
      return (await this.user.threads.projects()).find((project) => project.repository === key)
    } catch (error) {
      if (!this.bundled) throw error
      // Not running or a different protocol: the bundled engine takes the chat.
      if (!(error instanceof UserError)) logError('Reaching T3 Code', error)
      return undefined
    }
  }

  /** One clone per repository, however many chats ask for it at once. */
  private bundledProject(
    bundled: BundledEngineHost,
    repository: { owner: string; repo: string },
    key: string,
  ): Promise<EngineProject> {
    const pending = this.clones.get(key)
    if (pending) return pending
    const destinationPath = join(bundled.home, 'repositories', repository.owner, repository.repo)
    const ready = (async () => {
      const existing = (await bundled.threads.projects()).find(
        (project) => project.repository === key || project.workspaceRoot === destinationPath,
      )
      if (!existing)
        return bundled.threads.cloneProject({
          repository: `${repository.owner}/${repository.repo}`,
          title: repository.repo,
          destinationPath,
        })
      await bundled.threads.settleClone(existing.id)
      return existing
    })().finally(() => this.clones.delete(key))
    this.clones.set(key, ready)
    return ready
  }
}

/** Open the thread in the bundled engine's web app, signed in with a one-time pairing token. */
async function openBundledThread(bundled: BundledEngineHost, threadId: string): Promise<void> {
  const engine = await bundled.connection.locate()
  const token = await (bundled.mintToken ?? mintPairingToken)(engine, CHAT_WINDOW_LABEL, {
    cli: bundled.engine.cli(),
  })
  const url = new URL(
    `/${encodeURIComponent(engine.environmentId)}/${encodeURIComponent(threadId)}`,
    engine.origin,
  )
  url.hash = new URLSearchParams({ token }).toString()
  await (bundled.openUrl ?? openInBrowser)(url.toString())
}

async function revealT3Code(): Promise<void> {
  if (process.platform !== 'darwin') return
  await runCommand({ command: 'open', args: ['-b', 'com.t3tools.t3code'] }).catch(() => {
    throw new UserError(
      'The chat started in T3 Code, but Slopbusters could not bring T3 Code forward.',
    )
  })
}

async function openInBrowser(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  await runCommand({ command, args }).catch((error: unknown) => {
    logError('Opening the chat', error)
    throw new UserError('The chat started, but Slopbusters could not open it.')
  })
}
