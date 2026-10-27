import { randomUUID } from 'node:crypto'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import { CommandId, RunId, ThreadId, type OrchestrationV2Command } from '@t3tools/contracts'
import type { EngineClient } from './engineConnection'
import type { TurnFollower, TurnOutcome } from './turnFollower'

export type TurnStart = Extract<OrchestrationV2Command, { type: 'message.dispatch' }>

export type FollowedTurn = TurnOutcome | { readonly status: 'cancelled' | 'timeout' | 'unstarted' }

/**
 * Subscribe to the thread, send the prompt once the snapshot arrives, and answer what the agent
 * asks until the turn ends. Cancelling, running out of time, or a turn the provider never picks
 * up within `startTimeoutMs` interrupts the turn first.
 */
export function followTurn(
  client: EngineClient,
  input: {
    start: TurnStart
    follower: TurnFollower
    signal: AbortSignal
    timeoutMs: number
    startTimeoutMs: number
  },
): Effect.Effect<FollowedTurn, unknown> {
  const { start, follower } = input
  const dispatch = (command: OrchestrationV2Command) =>
    client['orchestration.dispatchCommand'](command)
  const followed = client['orchestration.subscribeThread']({ threadId: start.threadId }).pipe(
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
  const unstarted = Effect.sleep(input.startTimeoutMs).pipe(
    Effect.flatMap(() => (follower.began ? Effect.never : Effect.succeed('unstarted' as const))),
  )
  const stopped = Effect.raceAll([
    whenAborted(input.signal),
    Effect.sleep(input.timeoutMs).pipe(Effect.as('timeout' as const)),
    unstarted,
  ]).pipe(
    Effect.flatMap((status) => {
      // A turn the engine has not made a run for yet has nothing to interrupt.
      const runId = follower.run
      const interrupt = runId
        ? dispatch({
            type: 'run.interrupt',
            ...commandBase(start.threadId),
            runId: RunId.make(runId),
          }).pipe(Effect.ignore)
        : Effect.void
      return interrupt.pipe(Effect.as<FollowedTurn>({ status }))
    }),
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

export function commandBase(threadId: string) {
  return { commandId: CommandId.make(randomUUID()), threadId: ThreadId.make(threadId) }
}
