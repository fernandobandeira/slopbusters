import { setTimeout as sleep } from 'node:timers/promises'
import type { GandalfSession } from '../../../shared/domain/gandalf'
import { BaseAdvancedError } from '../../adapters/conflictRevision'
import { NetworkError } from '../../adapters/network'
import { CommandTimeoutError } from '../../adapters/process'
import { TurnNotStartedError } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import { MAX_GANDALF_BASE_RETRIES, MAX_GANDALF_TIMEOUT_RETRIES } from './limits'

/**
 * Whether a session that stopped on `cause` restarts on its own: once for a timeout, a few times
 * for a moved base, and after growing delays for GitHub connection drops. A restart rechecks the
 * stack from the start; published layers are detected as up to date.
 */
export async function retryAutomatically({
  session,
  cause,
  signal,
  delays,
  progress,
}: {
  session: GandalfSession
  cause: unknown
  signal: AbortSignal
  delays: readonly number[]
  progress: (text: string) => void
}) {
  if (
    cause instanceof CommandTimeoutError &&
    (session.timeoutRetries ?? 0) < MAX_GANDALF_TIMEOUT_RETRIES
  ) {
    session.timeoutRetries = (session.timeoutRetries ?? 0) + 1
    progress('A command timed out. Automatically retrying the unfinished resolution…')
    return true
  }
  if (cause instanceof BaseAdvancedError && (session.baseRetries ?? 0) < MAX_GANDALF_BASE_RETRIES) {
    session.baseRetries = (session.baseRetries ?? 0) + 1
    progress('A base branch gained commits during resolution. Rechecking the stack against them…')
    return true
  }
  const attempt = session.networkRetries ?? 0
  const delay = delays[attempt]
  if (!(cause instanceof NetworkError) || delay === undefined) return false
  session.networkRetries = attempt + 1
  progress(
    `GitHub did not respond. Retrying automatically in ${String(Math.round(delay / 1000))} seconds (attempt ${String(attempt + 1)} of ${String(delays.length)})…`,
  )
  // Cancellation and sleep end the wait; the loop then stops on the aborted signal.
  await sleep(delay, undefined, { signal }).catch(() => undefined)
  return true
}

/**
 * A PR's own outcome, such as models that do not agree or a file Gandalf cannot resolve, leaves
 * that PR and its stack children untouched and moves on. Unexpected errors, timeouts, a moved
 * base, network drops and an engine that never starts a turn stop the session, which recovers or
 * retries as a whole.
 */
export function failsOnlyThisPull(cause: unknown) {
  return (
    cause instanceof UserError &&
    !(cause instanceof BaseAdvancedError) &&
    !(cause instanceof NetworkError) &&
    !(cause instanceof TurnNotStartedError)
  )
}
