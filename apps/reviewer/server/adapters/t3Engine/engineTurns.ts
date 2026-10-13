import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import type { z } from 'zod'
import {
  CommandId,
  MessageId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
  type RuntimeMode,
} from '@t3tools/contracts'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { Provider } from '../../../shared/domain/types'
import { logError } from '../../errors'
import {
  PROVIDER_TIMEOUT_MS,
  T3_ENGINE_TURN_INPUT_MARGIN_CHARS,
  T3_ENGINE_TURN_MARGIN_MS,
} from '../../limits'
import { copyForInspection, listInspectionFiles } from '../inspectionCopy'
import { CommandTimeoutError } from '../process'
import type { EngineClient, EngineConnection } from './engineConnection'
import {
  correctionPrompt,
  instructionsInFile,
  OVERFLOW_DIRECTORY,
  parseStructuredReply,
  withOutputContract,
  wrapLongLines,
  type FileListing,
  type InspectionFiles,
} from './structuredOutput'
import { TurnFollower, type TurnOutcome } from './turnFollower'

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
  readonly observer?: ProviderObserver
  /** The whole run, including a corrective turn; defaults to `PROVIDER_TIMEOUT_MS`. */
  readonly timeoutMs?: number
  /** Names the thread in the engine's sidebar, e.g. `Linus review`. */
  readonly purpose?: string
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

type FollowedTurn = TurnOutcome | { readonly status: 'cancelled' | 'timeout' }

/**
 * Structured turns on a T3 Code engine. Each run gets its own project in a disposable copy of the
 * directory, scrubbed of repository agent configuration, and one thread there in which every
 * approval the agent asks for is declined. The thread is archived, and the project and copy are
 * deleted, when the run ends.
 */
export class EngineTurns implements StructuredTurns {
  constructor(private readonly connection: Pick<EngineConnection, 'run'>) {}

  async run<T>(request: StructuredTurnRequest<T>): Promise<T> {
    request.signal.throwIfAborted()
    request.observer?.({
      id: 'prompt',
      kind: 'prompt',
      text: request.prompt,
      title: 'Instructions',
    })
    const deadline = Date.now() + (request.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    const workspace = await this.workspace(request.directory, request.signal)
    try {
      const thread = await this.createThread(workspace.projectId, request)
      try {
        return await this.converse(thread, request, {
          deadline,
          message: await firstMessage(request, workspace),
        })
      } finally {
        await this.archive(thread.id)
      }
    } finally {
      await workspace.release()
    }
  }

  /** Ask for the reply, and once more quoting the problem if it does not match the schema. */
  private async converse<T>(
    thread: TurnThread,
    request: StructuredTurnRequest<T>,
    { deadline, message }: { deadline: number; message: string },
  ): Promise<T> {
    const first = await this.turn(thread, message, {
      request,
      deadline,
    })
    const reply = parseStructuredReply(first, request.schema)
    if (reply.success) return reply.data
    const correction = correctionPrompt(reply.error)
    request.observer?.({ id: 'correction', kind: 'prompt', text: correction, title: 'Correction' })
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
    const remaining = Math.max(0, deadline - Date.now())
    const messageId = randomUUID()
    const follower = new TurnFollower(thread.id, messageId, thread.answered, request.observer)
    const start: ClientOrchestrationCommand = {
      type: 'thread.turn.start',
      ...commandBase(thread.id),
      message: { messageId: MessageId.make(messageId), role: 'user', text, attachments: [] },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: 'default',
      createdAt: now(),
    }
    const outcome = await this.connection.run(
      (client) =>
        followTurn(client, { start, follower, signal: request.signal, timeoutMs: remaining }),
      remaining + T3_ENGINE_TURN_MARGIN_MS,
    )
    const agent = agentName(request.model)
    switch (outcome.status) {
      case 'completed':
        return outcome.replies
      case 'failed':
        throw new Error(`${agent} failed: ${outcome.error}`)
      case 'interrupted':
        throw new Error(`${agent} stopped before it finished.`)
      case 'cancelled':
        throw new Error('The operation was cancelled.')
      case 'timeout':
        throw new CommandTimeoutError(agent)
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
      runtimeMode: runtimeModeFor(request.model),
      answered: new Set(),
    }
    await this.dispatch({
      type: 'thread.create',
      ...commandBase(thread.id),
      projectId: ProjectId.make(projectId),
      title: `Slopbusters · ${request.purpose?.trim() || 'structured turn'}`,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: 'default',
      branch: null,
      worktreePath: null,
      createdAt: now(),
    })
    return thread
  }

  /** Stop the thread's agent session and archive it; a failure here only logs. */
  private async archive(threadId: string) {
    try {
      await this.dispatch({
        type: 'thread.session.stop',
        ...commandBase(threadId),
        createdAt: now(),
      })
      await this.dispatch({ type: 'thread.archive', ...commandBase(threadId) })
    } catch (error) {
      logError('T3 Code could not archive a structured turn thread', error)
    }
  }

  /**
   * A per-run project in a throwaway directory: a scrubbed copy of `directory`, or an empty one.
   * The project and the directory are deleted when the run ends.
   */
  private async workspace(directory: string | undefined, signal: AbortSignal): Promise<Workspace> {
    const root = await mkdtemp(join(tmpdir(), 'slopbusters-turn-'))
    const removeRoot = () => rm(root, { recursive: true, force: true })
    let projectId: string
    let files: InspectionFiles | undefined
    const workspaceRoot = directory ? join(root, basename(resolve(directory)) || 'source') : root
    try {
      if (directory) {
        await copyForInspection(directory, workspaceRoot, signal)
        files = await listInspectionFiles(workspaceRoot)
      }
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
          await this.dispatch({
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
    await this.dispatch({
      type: 'project.create',
      commandId: CommandId.make(randomUUID()),
      projectId,
      title,
      workspaceRoot,
      createdAt: now(),
    })
    return projectId
  }

  private dispatch(command: ClientOrchestrationCommand) {
    return this.connection.run((client) => client['orchestration.dispatchCommand'](command))
  }
}

/**
 * Subscribe to the thread, send the prompt once the snapshot arrives, and answer what the agent
 * asks until the turn ends. Cancelling or running out of time interrupts the turn first.
 */
function followTurn(
  client: EngineClient,
  input: {
    start: Extract<ClientOrchestrationCommand, { type: 'thread.turn.start' }>
    follower: TurnFollower
    signal: AbortSignal
    timeoutMs: number
  },
): Effect.Effect<FollowedTurn, unknown> {
  const { start, follower } = input
  const dispatch = (command: ClientOrchestrationCommand) =>
    client['orchestration.dispatchCommand'](command)
  const followed = client['orchestration.subscribeThread']({
    threadId: start.threadId,
    reasoningMessages: true,
  }).pipe(
    Stream.mapEffect((item) => {
      const step = follower.receive(item)
      const commands = [...(step.start ? [start] : []), ...step.responses]
      return Effect.forEach(commands, dispatch, { discard: true }).pipe(Effect.as(step.outcome))
    }),
    Stream.filter((outcome): outcome is TurnOutcome => outcome !== undefined),
    Stream.runHead,
    Effect.map(
      Option.getOrElse((): FollowedTurn => ({
        status: 'failed',
        error: 'T3 Code closed the thread.',
      })),
    ),
  )
  const stopped = Effect.raceFirst(
    whenAborted(input.signal),
    Effect.sleep(input.timeoutMs).pipe(Effect.as('timeout' as const)),
  ).pipe(
    Effect.flatMap((status) =>
      dispatch({
        type: 'thread.turn.interrupt',
        ...commandBase(start.threadId),
        createdAt: now(),
      }).pipe(Effect.ignore, Effect.as<FollowedTurn>({ status })),
    ),
  )
  return Effect.raceFirst(followed, stopped)
}

function whenAborted(signal: AbortSignal): Effect.Effect<'cancelled'> {
  return Effect.callback<'cancelled'>((resume) => {
    const abort = () => {
      resume(Effect.succeed('cancelled'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

function commandBase(threadId: string) {
  return { commandId: CommandId.make(randomUUID()), threadId: ThreadId.make(threadId) }
}

function now() {
  return new Date().toISOString()
}

/**
 * Claude asks before every edit and every command it does not consider read-only, and each ask is
 * declined. Codex in that mode asks even for `ls`, so it gets T3 Code's workspace-write sandbox
 * instead (network off, approval on request): it runs read commands in the run's copy without
 * asking, its writes can only land in that throwaway copy, and any escalation it asks for is
 * declined.
 */
function runtimeModeFor(model: OrganizationPreferences): RuntimeMode {
  return model.provider === Provider.claude ? 'approval-required' : 'auto-accept-edits'
}

function agentName(model: OrganizationPreferences) {
  return model.provider === Provider.claude ? 'Claude' : 'Codex'
}

/**
 * The first message: the prompt and its output contract. The engine refuses a turn input over
 * `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`, so what does not fit moves into files in the working
 * directory, first Claude's file list and then the prompt itself.
 */
async function firstMessage<T>(
  request: StructuredTurnRequest<T>,
  workspace: Workspace,
): Promise<string> {
  const agent = request.model.provider
  const fits = (message: string) =>
    message.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS - T3_ENGINE_TURN_INPUT_MARGIN_CHARS
  const inline = withOutputContract(request.prompt, request.schema, agent, workspace.files)
  if (fits(inline)) return inline
  const overflow = join(workspace.root, OVERFLOW_DIRECTORY)
  await mkdir(overflow, { recursive: true })
  let files: FileListing | undefined = workspace.files
  if (workspace.files) {
    const path = `${OVERFLOW_DIRECTORY}/files.txt`
    await writeFile(join(workspace.root, path), `${workspace.files.paths.join('\n')}\n`)
    files = { path, count: workspace.files.paths.length }
    const listed = withOutputContract(request.prompt, request.schema, agent, files)
    if (fits(listed)) return listed
  }
  const path = `${OVERFLOW_DIRECTORY}/instructions.md`
  const instructions = wrapLongLines(request.prompt)
  await writeFile(join(workspace.root, path), instructions)
  return withOutputContract(
    instructionsInFile(path, instructions, agent),
    request.schema,
    agent,
    files,
  )
}
