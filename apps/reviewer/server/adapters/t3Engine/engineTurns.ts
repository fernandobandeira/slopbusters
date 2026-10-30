import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { z } from 'zod'
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationV2Command,
  type ProjectMutation,
  type RuntimeMode,
} from '@t3tools/contracts'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { Provider } from '../../../shared/domain/types'
import { logError, UserError } from '../../errors'
import {
  MAX_STRUCTURED_FOLLOW_UPS,
  MAX_T3_ENGINE_TURN_REATTACHES,
  PROVIDER_TIMEOUT_MS,
  T3_ENGINE_TURN_MARGIN_MS,
  T3_ENGINE_TURN_START_TIMEOUT_MS,
} from '../../limits'
import { copyForInspection, listInspectionFiles } from '../inspectionCopy'
import { CommandTimeoutError } from '../process'
import { EngineDisconnectedError, type EngineConnection } from './engineConnection'
import {
  correctionPrompt,
  followUpPrompt,
  parseStructuredReply,
  type CopyAccess,
  type InspectionFiles,
} from './structuredOutput'
import { firstMessage } from './firstMessage'
import { commandBase, followTurn, type FollowedTurn, type TurnStart } from './followTurn'
import { TurnFollower } from './turnFollower'

export interface StructuredTurnRequest<T> {
  readonly model: OrganizationPreferences
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly signal: AbortSignal
  /**
   * A directory the agent may read. The agent works in a disposable copy of it, so the directory
   * is never modified. Omitted: an empty scratch directory.
   */
  readonly directory?: string
  /**
   * Folders copied into the working directory beside it, at paths relative to its root, such as
   * the skill folder a reviewer reads its references from. Copies, like the directory's, are
   * scrubbed of agent configuration and deleted with the run.
   */
  readonly include?: readonly IncludedFolder[]
  /** What the agent may do in its copy of `directory`; by default it only reads. */
  readonly copy?: WorkingCopy<T>
  readonly observer?: ProviderObserver
  /** The whole run, including a corrective turn; defaults to `PROVIDER_TIMEOUT_MS`. */
  readonly timeoutMs?: number
  /** Names the thread in the engine's sidebar, e.g. `Linus review`. */
  readonly purpose?: string
}

/**
 * A copy the agent may keep Git metadata in, or edit. The caller reads the edits back in `settle`,
 * since the copy is deleted when the run ends.
 */
export interface WorkingCopy<T> extends CopyAccess {
  /**
   * Runs on the copy after each valid reply, before the copy is deleted. A returned message goes
   * back to the agent in the same thread, at most `MAX_STRUCTURED_FOLLOW_UPS` times, and its next
   * reply is settled again; undefined accepts the reply. After the last follow-up the newest reply
   * is returned whatever `settle` says.
   */
  settle?(copy: string, reply: T): Promise<string | undefined>
}

/** The engine accepted a turn but never started it: the engine, not the task, is at fault. */
export class TurnNotStartedError extends UserError {}
/** The turn ended without a reply, as when its engine stopped and the next one recovered it. */
export class TurnInterruptedError extends Error {}
/** The provider reported the turn failed, with its reason. */
export class ProviderTurnError extends Error {}

export interface IncludedFolder {
  readonly directory: string
  /** Where the copy goes, relative to the working directory, such as `.slopbusters/skill`. */
  readonly as: string
}

/** One read-only agent turn whose reply is a JSON object validated against a schema. */
export interface StructuredTurns {
  run<T>(request: StructuredTurnRequest<T>): Promise<T>
}

interface TurnThread {
  readonly id: string
  readonly modelSelection: { instanceId: ProviderInstanceId; model: string }
  readonly runtimeMode: RuntimeMode
  /** Approval and question ids already answered, so no request is answered twice. */
  readonly answered: Set<string>
}

interface Workspace {
  readonly projectId: string
  /** The agent's working directory: the copy, or an empty scratch directory. */
  readonly root: string
  /** The copy's files, when the run inspects a directory. */
  readonly files?: InspectionFiles
  release(): Promise<void>
}

/**
 * Structured turns on a T3 Code engine. Each run gets its own project in a disposable copy of the
 * directory, scrubbed of repository agent configuration, and one thread there in which every
 * approval the agent asks for is declined. The thread is archived, and the project and copy are
 * deleted, when the run ends.
 */
export class EngineTurns implements StructuredTurns {
  constructor(
    private readonly connection: Pick<EngineConnection, 'run'>,
    private readonly startTimeoutMs = T3_ENGINE_TURN_START_TIMEOUT_MS,
  ) {}

  async run<T>(request: StructuredTurnRequest<T>): Promise<T> {
    request.signal.throwIfAborted()
    request.observer?.({
      id: 'prompt',
      kind: 'prompt',
      text: request.prompt,
      title: 'Instructions',
    })
    const deadline = Date.now() + (request.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    const workspace = await this.workspace(request, request.signal)
    try {
      const thread = await this.createThread(workspace.projectId, request)
      try {
        const reply = await this.converse(thread, request, {
          deadline,
          message: await firstMessage(request, workspace),
          round: 0,
        })
        return await this.settle(thread, request, { deadline, copy: workspace.root, reply })
      } finally {
        await this.archive(thread.id)
      }
    } finally {
      await workspace.release()
    }
  }

  /** Let the caller check the copy, and send what it finds back until it is satisfied. */
  private async settle<T>(
    thread: TurnThread,
    request: StructuredTurnRequest<T>,
    { deadline, copy, reply }: { deadline: number; copy: string; reply: T },
  ): Promise<T> {
    let settled = reply
    for (let round = 1; request.copy?.settle; round++) {
      const problems = await request.copy.settle(copy, settled)
      if (!problems || round > MAX_STRUCTURED_FOLLOW_UPS) break
      const message = followUpPrompt(problems)
      request.observer?.({
        id: `follow-up-${String(round)}`,
        kind: 'prompt',
        text: message,
        title: 'Follow-up',
      })
      settled = await this.converse(thread, request, { deadline, message, round })
    }
    return settled
  }

  /** Ask for the reply, and once more quoting the problem if it does not match the schema. */
  private async converse<T>(
    thread: TurnThread,
    request: StructuredTurnRequest<T>,
    { deadline, message, round }: { deadline: number; message: string; round: number },
  ): Promise<T> {
    const first = await this.turn(thread, message, {
      request,
      deadline,
    })
    const reply = parseStructuredReply(first, request.schema)
    if (reply.success) return reply.data
    const correction = correctionPrompt(reply.error)
    request.observer?.({
      id: round ? `correction-${String(round)}` : 'correction',
      kind: 'prompt',
      text: correction,
      title: 'Correction',
    })
    const second = await this.turn(thread, correction, { request, deadline })
    const corrected = parseStructuredReply(second, request.schema)
    if (corrected.success) return corrected.data
    throw new Error(
      `${agentName(request.model)} did not reply with the requested JSON: ${corrected.error}`,
    )
  }

  /** Send one message and follow the thread until its turn ends, is cancelled or times out. */
  private async turn<T>(
    thread: TurnThread,
    text: string,
    { request, deadline }: { request: StructuredTurnRequest<T>; deadline: number },
  ): Promise<readonly string[]> {
    const messageId = randomUUID()
    const follower = new TurnFollower(thread.id, messageId, thread.answered, request.observer)
    const start: TurnStart = {
      type: 'message.dispatch',
      ...commandBase(thread.id),
      ...CREATED_BY_USER,
      messageId: MessageId.make(messageId),
      text,
      attachments: [],
      modelSelection: thread.modelSelection,
      dispatchMode: { type: 'start_immediately' },
    }
    const outcome = await this.follow({ start, follower, signal: request.signal, deadline })
    const agent = agentName(request.model)
    switch (outcome.status) {
      case 'completed':
        return outcome.replies
      case 'failed':
        throw new ProviderTurnError(`${agent} failed: ${outcome.error}`)
      case 'interrupted':
        throw new TurnInterruptedError(`${agent} stopped before it finished.`)
      case 'cancelled':
        throw new Error('The operation was cancelled.')
      case 'timeout':
        throw new CommandTimeoutError(agent)
      case 'unstarted':
        throw new TurnNotStartedError(
          `${agent} never started this turn: T3 Code accepted it but opened no session within ${String(Math.round(this.startTimeoutMs / 60_000))} minutes. Restart Slopbusters, then retry.`,
        )
    }
  }

  /**
   * Follow the turn until it settles. A dropped socket, as when the computer sleeps, does not stop
   * the turn in the engine, so it is followed again on a new socket from a fresh snapshot. The
   * prompt goes out again, with the same command id, only if that snapshot does not hold it.
   */
  private async follow({
    start,
    follower,
    signal,
    deadline,
  }: {
    start: TurnStart
    follower: TurnFollower
    signal: AbortSignal
    deadline: number
  }): Promise<FollowedTurn> {
    for (let attempt = 0; ; attempt++) {
      const remaining = Math.max(0, deadline - Date.now())
      try {
        return await this.connection.run(
          (client) =>
            followTurn(client, {
              start,
              follower,
              signal,
              timeoutMs: remaining,
              startTimeoutMs: Math.min(this.startTimeoutMs, remaining),
            }),
          remaining + T3_ENGINE_TURN_MARGIN_MS,
        )
      } catch (error) {
        if (!(error instanceof EngineDisconnectedError) || attempt >= MAX_T3_ENGINE_TURN_REATTACHES)
          throw error
        logError('Following a structured turn again after T3 Code lost the connection', error)
      }
    }
  }

  private async createThread<T>(
    projectId: string,
    request: StructuredTurnRequest<T>,
  ): Promise<TurnThread> {
    const thread: TurnThread = {
      id: randomUUID(),
      modelSelection: {
        instanceId: ProviderInstanceId.make(
          request.model.provider === Provider.claude ? 'claudeAgent' : 'codex',
        ),
        model: request.model.model,
      },
      runtimeMode: runtimeModeFor(request.model, request.copy?.editable),
      answered: new Set(),
    }
    await this.dispatch({
      type: 'thread.create',
      ...commandBase(thread.id),
      ...CREATED_BY_USER,
      projectId: ProjectId.make(projectId),
      title: `Slopbusters · ${request.purpose?.trim() || 'structured turn'}`,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: 'default',
      branch: null,
      worktreePath: null,
    })
    return thread
  }

  /** Archive the thread, which also stops its agent session; a failure here only logs. */
  private async archive(threadId: string) {
    try {
      await this.dispatch({ type: 'thread.archive', ...commandBase(threadId) })
    } catch (error) {
      logError('T3 Code could not archive a structured turn thread', error)
    }
  }

  /**
   * A per-run project in a throwaway directory: a scrubbed copy of `directory`, or an empty one.
   * The project and the directory are deleted when the run ends.
   */
  private async workspace<T>(
    { directory, include = [], copy }: StructuredTurnRequest<T>,
    signal: AbortSignal,
  ): Promise<Workspace> {
    const root = await mkdtemp(join(tmpdir(), 'slopbusters-turn-'))
    const removeRoot = () => rm(root, { recursive: true, force: true })
    let projectId: string
    let files: InspectionFiles | undefined
    const workspaceRoot = directory ? join(root, basename(resolve(directory)) || 'source') : root
    try {
      if (directory) {
        await copyForInspection(directory, workspaceRoot, signal, { git: copy?.git })
        files = await listInspectionFiles(workspaceRoot)
      }
      for (const folder of include) await copyIncluded(folder, workspaceRoot, signal)
      projectId = await this.createProject(workspaceRoot, basename(workspaceRoot))
    } catch (error) {
      await removeRoot()
      throw error
    }
    return {
      projectId,
      root: workspaceRoot,
      files,
      release: async () => {
        try {
          await this.mutateProject({
            type: 'project.delete',
            commandId: CommandId.make(randomUUID()),
            projectId: ProjectId.make(projectId),
            force: true,
          })
        } catch (error) {
          logError('T3 Code could not delete a structured turn project', error)
        }
        await removeRoot()
      },
    }
  }

  private async createProject(workspaceRoot: string, title: string): Promise<string> {
    const projectId = ProjectId.make(randomUUID())
    await this.mutateProject({
      type: 'project.create',
      commandId: CommandId.make(randomUUID()),
      projectId,
      title,
      workspaceRoot,
    })
    return projectId
  }

  private dispatch(command: OrchestrationV2Command) {
    return this.connection.run((client) => client['orchestration.dispatchCommand'](command))
  }

  private mutateProject(mutation: ProjectMutation) {
    return this.connection.run((client) => client['projects.mutate'](mutation))
  }
}

/** Copy an included folder to its place inside the working directory, never outside it. */
async function copyIncluded(folder: IncludedFolder, workspaceRoot: string, signal: AbortSignal) {
  const destination = resolve(workspaceRoot, folder.as)
  if (!destination.startsWith(`${resolve(workspaceRoot)}${sep}`))
    throw new Error(`An included folder must stay inside the working directory: ${folder.as}`)
  await mkdir(dirname(destination), { recursive: true })
  await copyForInspection(folder.directory, destination, signal)
}

/** Threads and messages Slopbusters creates are the user's, sent from a T3 Code client. */
const CREATED_BY_USER = { createdBy: 'user', creationSource: 'web' } as const

/**
 * Claude asks before every edit and every command it does not consider read-only, and each ask is
 * declined; in a copy it may edit, its edits are accepted (Claude Code's acceptEdits, confined to
 * the working directory) and other commands are still declined. Codex in the asking mode asks even
 * for `ls`, so it always gets T3 Code's workspace-write sandbox instead (network off, approval on
 * request): it runs read commands in the run's copy without asking, its writes can only land in
 * that throwaway copy, and any escalation it asks for is declined.
 */
function runtimeModeFor(model: OrganizationPreferences, editable = false): RuntimeMode {
  return model.provider === Provider.claude && !editable ? 'approval-required' : 'auto-accept-edits'
}

function agentName(model: OrganizationPreferences) {
  return model.provider === Provider.claude ? 'Claude' : 'Codex'
}
