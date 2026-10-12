import { randomUUID } from 'node:crypto'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
} from '@t3tools/contracts'
import { UserError } from '../../errors'
import { runCommand } from '../process'
import type { EngineConnection } from './engineConnection'

/** A T3 Code project, with the canonical key of the repository it is a checkout of. */
export interface EngineProject {
  readonly id: string
  readonly title: string
  readonly workspaceRoot: string
  /** e.g. `github.com/owner/repo`, lowercase; undefined for folders without a known remote. */
  readonly repository?: string
}

export interface PreparedPullRequest {
  readonly branch: string
  readonly worktreePath: string | null
  readonly onPullRequestHead: boolean
}

export interface EngineThreadStart {
  readonly threadId: string
  readonly projectId: string
  readonly title: string
  readonly model: { readonly instanceId: string; readonly model: string }
  readonly branch: string
  readonly worktreePath: string | null
  readonly pullRequest: {
    readonly host: string
    readonly repository: string
    readonly number: number
    readonly url: string
  }
  readonly message: string
}

/** Thread operations on the user's T3 Code engine, as the reviewer's features need them. */
export interface EngineThreadOperations {
  projects(): Promise<EngineProject[]>
  preparePullRequest(input: {
    readonly cwd: string
    readonly url: string
    readonly threadId: string
  }): Promise<PreparedPullRequest>
  startThread(input: EngineThreadStart): Promise<void>
  reveal(): Promise<void>
}

export class EngineThreads implements EngineThreadOperations {
  constructor(
    private readonly connection: Pick<EngineConnection, 'run'>,
    private readonly revealApp: () => Promise<void> = revealT3Code,
  ) {}

  projects(): Promise<EngineProject[]> {
    return this.connection.run((client) =>
      client['orchestration.subscribeShell']({}).pipe(
        Stream.filter((item) => item.kind === 'snapshot'),
        Stream.runHead,
        Effect.map((item) =>
          item._tag === 'Some'
            ? item.value.snapshot.projects.map((project) => ({
                id: project.id,
                title: project.title,
                workspaceRoot: project.workspaceRoot,
                ...(project.repositoryIdentity
                  ? { repository: project.repositoryIdentity.canonicalKey.toLowerCase() }
                  : {}),
              }))
            : [],
        ),
      ),
    )
  }

  async preparePullRequest(input: {
    cwd: string
    url: string
    threadId: string
  }): Promise<PreparedPullRequest> {
    const result = await this.connection.run((client) =>
      client['git.preparePullRequestThread']({
        cwd: input.cwd,
        reference: input.url,
        mode: 'worktree',
        threadId: ThreadId.make(input.threadId),
      }),
    )
    return {
      branch: result.branch,
      worktreePath: result.worktreePath,
      onPullRequestHead: result.isOnPullRequestHead,
    }
  }

  /**
   * Create the thread, link its pull request, and send the first message, in that order. The
   * thread starts in the runtime mode T3 Code gives new threads in that project.
   */
  startThread(input: EngineThreadStart): Promise<void> {
    const threadId = ThreadId.make(input.threadId)
    const projectId = ProjectId.make(input.projectId)
    const modelSelection = {
      instanceId: ProviderInstanceId.make(input.model.instanceId),
      model: input.model.model,
    }
    const interactionMode = 'default' as const
    return this.connection.run((client) =>
      Effect.gen(function* () {
        const { settings } = yield* client['server.getConfig']({})
        const runtimeMode =
          settings.projectSettingsOverrides[projectId]?.defaultRuntimeMode ??
          settings.defaultRuntimeMode
        const dispatch = (command: ClientOrchestrationCommand) =>
          client['orchestration.dispatchCommand'](command)
        yield* dispatch({
          type: 'thread.create',
          commandId: newCommandId(),
          threadId,
          projectId,
          title: input.title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: input.branch,
          worktreePath: input.worktreePath,
          createdAt: new Date().toISOString(),
        })
        yield* dispatch({
          type: 'thread.pull-request.link',
          commandId: newCommandId(),
          threadId,
          ...input.pullRequest,
          source: 'manual',
        })
        yield* dispatch({
          type: 'thread.turn.start',
          commandId: newCommandId(),
          threadId,
          message: {
            messageId: MessageId.make(randomUUID()),
            role: 'user',
            text: input.message,
            attachments: [],
          },
          modelSelection,
          runtimeMode,
          interactionMode,
          createdAt: new Date().toISOString(),
        })
      }),
    )
  }

  reveal(): Promise<void> {
    return this.revealApp()
  }
}

function newCommandId() {
  return CommandId.make(randomUUID())
}

/** Bring T3 Code to the front, where the new thread is at the top of the sidebar. */
async function revealT3Code(): Promise<void> {
  if (process.platform !== 'darwin') return
  await runCommand({ command: 'open', args: ['-b', 'com.t3tools.t3code'] }).catch(() => {
    throw new UserError(
      'Linus started in T3 Code, but Slopbusters could not bring T3 Code forward.',
    )
  })
}
