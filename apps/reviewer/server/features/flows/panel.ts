import { publicError, UserError } from '../../errors'

/** What one seat on a panel produced: its review, or the error that stopped it. */
export interface SeatOutcome<Advice> {
  advice?: Advice
  error?: string
}

/**
 * The first half of a panel: every seat reviews the same subject independently, at most
 * `concurrency` at a time. A seat that fails is recorded with its error rather than stopping the
 * others; cancellation rejects as soon as a seat sees it. Outcomes come back in seat order, and `landed` hears each
 * one as it finishes so the caller can save progress.
 */
export async function reviewSeats<Seat, Advice>(
  seats: readonly Seat[],
  options: {
    signal: AbortSignal
    concurrency: number
    review: (seat: Seat) => Promise<Advice>
    /** The message for a seat whose failure carries none safe to show. */
    failure: (seat: Seat) => string
    landed?: (seat: Seat, outcome: SeatOutcome<Advice>) => void
  },
): Promise<SeatOutcome<Advice>[]> {
  const { signal } = options
  const outcomes: SeatOutcome<Advice>[] = []
  const queue = seats.map((seat, index) => ({ seat, index }))
  const reviewOne = async ({ seat, index }: { seat: Seat; index: number }) => {
    let outcome: SeatOutcome<Advice>
    try {
      outcome = { advice: await options.review(seat) }
    } catch (error) {
      signal.throwIfAborted()
      outcome = { error: publicError(error, options.failure(seat)) }
    }
    signal.throwIfAborted()
    outcomes[index] = outcome
    options.landed?.(seat, outcome)
  }
  const workers = Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
    // A cancelled panel takes no more seats; the first seat to see the abort rejects the panel.
    for (let next = queue.shift(); next && !signal.aborted; next = queue.shift())
      await reviewOne(next)
  })
  await Promise.all(workers)
  signal.throwIfAborted()
  return outcomes
}

/**
 * The quorum before the second half of a panel: the outcomes that failed, so the caller can
 * stop for the user or judge without them. With no review at all there is nothing to judge, and
 * this throws every seat's error.
 */
export function failedSeats<Outcome extends SeatOutcome<unknown>>(
  outcomes: readonly Outcome[],
  describe: (outcome: Outcome) => string,
): Outcome[] {
  const failed = outcomes.filter((outcome) => !outcome.advice)
  if (failed.length === outcomes.length) throw new UserError(outcomes.map(describe).join('\n'))
  return failed
}
