import { setTimeout as delay } from 'node:timers/promises'
import { TRANSIENT_TURN_RETRY_DELAYS_MS } from './limits'
import { EngineDisconnectedError } from './engineConnection'
import { EngineUnreachableError } from './engineLocation'
import {
  ProviderTurnError,
  TurnInterruptedError,
  TurnNotStartedError,
  type StructuredTurnRequest,
  type StructuredTurns,
} from './engineTurns'

/** What providers say when they are busy rather than when the task went wrong. */
const BUSY_PROVIDER =
  /capacity|overloaded|rate.?limit|too many requests|temporarily|try again later|\b5\d\d\b/i

/**
 * A turn that failed because of the engine or a busy provider, not because of the task: the engine
 * stopped or restarted under it, stopped answering, never started it, dropped the socket, or the
 * provider was at capacity. Another attempt may well succeed. A timeout is not one: it says the
 * task took too long, and another attempt would take as long.
 */
export function isTransientTurnFailure(error: unknown): boolean {
  if (
    error instanceof TurnInterruptedError ||
    error instanceof TurnNotStartedError ||
    error instanceof EngineUnreachableError ||
    error instanceof EngineDisconnectedError
  )
    return true
  return error instanceof ProviderTurnError && BUSY_PROVIDER.test(error.message)
}

/**
 * Structured turns that run again, after a pause, when they fail for a transient reason, so a
 * restarted engine or a busy provider does not stop the work and call the user. Any other
 * failure, a cancellation, or the last attempt's failure is returned as it was.
 */
export class RetryingTurns implements StructuredTurns {
  constructor(
    private readonly turns: StructuredTurns,
    private readonly delaysMs: readonly number[] = TRANSIENT_TURN_RETRY_DELAYS_MS,
  ) {}

  async run<T>(request: StructuredTurnRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.turns.run(request)
      } catch (error) {
        const pause = this.delaysMs[attempt]
        if (pause === undefined || request.signal.aborted || !isTransientTurnFailure(error))
          throw error
        request.observer?.({
          id: `retry-${String(attempt + 1)}`,
          kind: 'activity',
          title: 'Retrying',
          text: `${error instanceof Error ? error.message : 'The turn failed.'} Trying again in ${String(Math.round(pause / 1000))} seconds.`,
          status: 'running',
        })
        await delay(pause, undefined, { signal: request.signal })
      }
    }
  }
}
