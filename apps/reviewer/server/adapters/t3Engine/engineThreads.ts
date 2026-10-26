import { randomUUID } from 'node:crypto'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SourceControlProviderKind,
  ThreadId,
  type OrchestrationV2Command,
  type ProjectCloneSnapshot,
} from '@t3tools/contracts'
import { UserError } from '../../errors'
import { T3_ENGINE_CLONE_TIMEOUT_MS } from '../../limits'
import { checkedOutBranch } from '../git'
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
  /** Null runs the thread in the project's own checkout. */
  readonly branch: string | null
  readonly worktreePath: string | null
  /** The pull request the thread is about, linked so T3 Code shows its status. */
  readonly pullRequest?: {
    readonly host: string
    readonly repository: string
    readonly number: number
    readonly url: string
  }
  readonly message: string
}

export interface EngineProjectClone {
  /** `owner/repo` on GitHub. */
  readonly repository: string
  readonly title: string
  readonly destinationPath: string
}

/** Thread operations on a T3 Code engine, as the reviewer's features need them. */
export interface EngineThreadOperations {
  projects(): Promise<EngineProject[]>
  /** Clone a repository into a new project, resolving once the checkout is ready. */
  cloneProject(input: EngineProjectClone): Promise<EngineProject>
  /** Wait for a project's clone if one is running, or retry it if it failed. */
  settleClone(projectId: string): Promise<void>
  /**
   * Check the PR out in its own worktree of the project, or when the project's own checkout is
   * already on the PR branch, use that checkout as it is.
   */
  preparePullRequest(input: {
    readonly cwd: string
    readonly url: string
    readonly threadId: string
    /** The PR head, to tell whether a reused checkout is on it. */
    readonly headSha?: string
  }): Promise<PreparedPullRequest>
  startThread(input: EngineThreadStart): Promise<void>
}

export class EngineThreads implements EngineThreadOperations {
  constructor(
    private readonly connection: Pick<EngineConnection, 'run'>,
    private readonly readCheckout: typeof checkedOutBranch = checkedOutBranch,
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

  async cloneProject(input: EngineProjectClone): Promise<EngineProject> {
    const projectId = ProjectId.make(randomUUID())
    const started = await this.connection.run((client) =>
      client['projectClone.start']({
        projectId,
        title: input.title,
        createdAt: new Date().toISOString(),
        provider: SourceControlProviderKind.make('github'),
        repository: input.repository,
        destinationPath: input.destinationPath,
      }),
    )
    await this.untilCloned(projectId)
    return {
      id: started.projectId,
      title: input.title,
      workspaceRoot: started.cwd,
      repository: `github.com/${input.repository}`.toLowerCase(),
    }
  }

  async settleClone(projectId: string): Promise<void> {
    const clone = await this.connection.run((client) =>
      client['subscribeProjectClones']({}).pipe(
        Stream.runHead,
        Effect.map((event) =>
          event._tag === 'Some'
            ? event.value.find((snapshot) => snapshot.projectId === projectId)
            : undefined,
        ),
      ),
    )
    if (!clone || clone.phase === 'done') return
    if (clone.phase !== 'running')
      await this.connection.run((client) =>
        client['projectClone.retry']({ projectId: ProjectId.make(projectId) }),
      )
    await this.untilCloned(projectId)
  }

  /** Follow the engine's clone progress until the project's clone finishes. */
  private async untilCloned(projectId: string): Promise<void> {
    const finished = await this.connection.run(
      (client) =>
        client['subscribeProjectClones']({}).pipe(
          Stream.map((event) => event.find((snapshot) => snapshot.projectId === projectId)),
          Stream.filter(
            (snapshot): snapshot is ProjectCloneSnapshot | undefined =>
              snapshot?.phase !== 'running',
          ),
          Stream.runHead,
        ),
      T3_ENGINE_CLONE_TIMEOUT_MS,
    )
    const clone = finished._tag === 'Some' ? finished.value : undefined
    if (clone && clone.phase !== 'done')
      throw new UserError(
        clone.error
          ? `T3 Code could not clone the repository: ${clone.error}`
          : 'T3 Code stopped cloning the repository.',
      )
  }

  async preparePullRequest(input: {
    cwd: string
    url: string
    threadId: string
    headSha?: string
  }): Promise<PreparedPullRequest> {
    const result = await this.connection
      .run((client) =>
        client['git.preparePullRequestThread']({
          cwd: input.cwd,
          reference: input.url,
          mode: 'worktree',
          threadId: ThreadId.make(input.threadId),
        }),
      )
      .catch(async (error: unknown) => {
        const checkout = isBranchInMainCheckout(error) && (await this.readCheckout(input.cwd))
        if (!checkout) throw error
        return checkout
      })
    if ('clean' in result)
      // T3 Code will not add a worktree for a branch the main checkout has, and its local mode
      // would force that branch to the PR head, dropping unpushed commits. Use the checkout as is.
      return {
        branch: result.branch,
        worktreePath: null,
        onPullRequestHead: result.clean && result.head === input.headSha,
      }
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
        const dispatch = (command: OrchestrationV2Command) =>
          client['orchestration.dispatchCommand'](command)
        yield* dispatch({
          type: 'thread.create',
          ...CREATED_BY_USER,
          commandId: newCommandId(),
          threadId,
          projectId,
          title: input.title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: input.branch,
          worktreePath: input.worktreePath,
        })
        if (input.pullRequest)
          yield* dispatch({
            type: 'thread.pull-request.link',
            commandId: newCommandId(),
            threadId,
            ...input.pullRequest,
            source: 'manual',
          })
        yield* dispatch({
          type: 'message.dispatch',
          ...CREATED_BY_USER,
          commandId: newCommandId(),
          threadId,
          messageId: MessageId.make(randomUUID()),
          text: input.message,
          attachments: [],
          modelSelection,
          dispatchMode: { type: 'start_immediately' },
        })
      }),
    )
  }
}

/** Threads and messages Slopbusters creates are the user's, sent from a T3 Code client. */
const CREATED_BY_USER = { createdBy: 'user', creationSource: 'web' } as const

function newCommandId() {
  return CommandId.make(randomUUID())
}

/** T3 Code's refusal to add a worktree for the branch the project's own checkout is on. */
function isBranchInMainCheckout(error: unknown): boolean {
  return error instanceof Error && /already checked out in the main repo/i.test(error.message)
}
