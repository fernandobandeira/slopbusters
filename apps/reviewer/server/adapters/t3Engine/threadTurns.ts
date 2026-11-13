import { randomUUID } from 'node:crypto'
import { MessageId, ProviderInstanceId } from '@t3tools/contracts'
import type { z } from 'zod'
import type { EngineConnection } from './engineConnection'
import { EngineDisconnectedError } from './engineConnection'
import type { EngineThreadStart, StartedEngineThread } from './engineThreads'
import { commandBase, followTurn, type FollowedTurn, type TurnStart } from './followTurn'
import {
  MAX_T3_ENGINE_TURN_REATTACHES,
  PROVIDER_TIMEOUT_MS,
  T3_ENGINE_TURN_MARGIN_MS,
  T3_ENGINE_TURN_START_TIMEOUT_MS,
} from './limits'
import { correctionPrompt, parseStructuredReply } from './structuredOutput'
import { TurnFollower } from './turnFollower'

export interface ObservedCommand {
  readonly id: string
  readonly input: string
  readonly output?: string
  readonly exitCode?: number
  readonly outputIndicatesFailure?: boolean
}

export interface ThreadTurnRequest<T> {
  readonly thread: StartedEngineThread
  readonly model: EngineThreadStart['model']
  readonly message: string
  readonly schema: z.ZodType<T>
  readonly signal: AbortSignal
  readonly timeoutMs?: number
  /** Follow the first message already dispatched by startThread rather than sending another. */
  readonly first?: boolean
  /** Called after every turn, including JSON correction, before another message is sent. */
  readonly settled?: (turn: ThreadTurnResult<T>) => Promise<void>
}

export interface ThreadTurnResult<T> {
  readonly outcome: FollowedTurn
  readonly commands: readonly ObservedCommand[]
  readonly report?: T
  readonly error?: string
}

/** Ordinary, retained threads; feature code never handles the engine RPC client. */
export interface ThreadTurns {
  run<T>(request: ThreadTurnRequest<T>): Promise<ThreadTurnResult<T>>
}

export class EngineThreadTurns implements ThreadTurns {
  constructor(private readonly connection: Pick<EngineConnection, 'run'>) {}

  async run<T>(request: ThreadTurnRequest<T>): Promise<ThreadTurnResult<T>> {
    const deadline = Date.now() + (request.timeoutMs ?? PROVIDER_TIMEOUT_MS)
    const commands: ObservedCommand[] = []
    let message = request.message
    for (let round = 0; round < 2; round++) {
      const result = await this.turn(request, message, deadline, round === 0 && request.first)
      commands.push(...result.commands)
      await request.settled?.({ ...result, commands })
      if (result.outcome.status !== 'completed' || result.error) return { ...result, commands }
      const parsed = parseStructuredReply(result.outcome.replies, request.schema)
      if (parsed.success) return { outcome: result.outcome, commands, report: parsed.data }
      if (round === 1)
        return { ...result, commands, error: `The worker report is invalid: ${parsed.error}` }
      message = correctionPrompt(parsed.error)
    }
    throw new Error('Unreachable report correction state.')
  }

  private async turn<T>(
    request: ThreadTurnRequest<T>,
    text: string,
    deadline: number,
    first = false,
  ): Promise<ThreadTurnResult<T>> {
    const messageId = first ? request.thread.messageId : randomUUID()
    const follower = new TurnFollower(request.thread.threadId, messageId, new Set())
    follower.stopForApprovals = true
    const start: TurnStart = {
      type: 'message.dispatch',
      ...commandBase(request.thread.threadId),
      createdBy: 'user',
      creationSource: 'web',
      messageId: MessageId.make(messageId),
      text,
      attachments: [],
      modelSelection: {
        instanceId: ProviderInstanceId.make(request.model.instanceId),
        model: request.model.model,
      },
      dispatchMode: { type: 'start_immediately' },
    }
    const outcome = await this.follow(start, follower, request.signal, deadline)
    const blocked = follower.declinedApprovals > 0
    return {
      outcome,
      commands: follower.commands.map(
        ({ id, input, output, exitCode, outputIndicatesFailure }) => ({
          id,
          input,
          ...(output !== undefined ? { output } : {}),
          ...(exitCode !== undefined ? { exitCode } : {}),
          ...(outputIndicatesFailure !== undefined ? { outputIndicatesFailure } : {}),
        }),
      ),
      ...(blocked
        ? {
            error: `The worker could not run commands in ${request.thread.runtimeMode} mode. Approvals were declined.`,
          }
        : {}),
    }
  }

  private async follow(
    start: TurnStart,
    follower: TurnFollower,
    signal: AbortSignal,
    deadline: number,
  ) {
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
              startTimeoutMs: Math.min(T3_ENGINE_TURN_START_TIMEOUT_MS, remaining),
            }),
          remaining + T3_ENGINE_TURN_MARGIN_MS,
        )
      } catch (error) {
        if (!(error instanceof EngineDisconnectedError) || attempt >= MAX_T3_ENGINE_TURN_REATTACHES)
          throw error
      }
    }
  }
}
