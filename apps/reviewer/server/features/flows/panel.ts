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
export function reviewSeats<Seat, Advice>(
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
  return settleEach(seats, { ...options, run: options.review })
}

/**
 * Run `run` for every item, at most `concurrency` at a time, recording a failure beside the other
 * results instead of stopping them. Cancellation rejects as soon as a run sees it.
 */
export async function settleEach<Item, Result>(
  items: readonly Item[],
  options: {
    signal: AbortSignal
    concurrency: number
    run: (item: Item) => Promise<Result>
    failure: (item: Item) => string
    landed?: (item: Item, outcome: SeatOutcome<Result>) => void
  },
): Promise<SeatOutcome<Result>[]> {
  const { signal } = options
  const outcomes: SeatOutcome<Result>[] = []
  const queue = items.map((item, index) => ({ item, index }))
  const runOne = async ({ item, index }: { item: Item; index: number }) => {
    let outcome: SeatOutcome<Result>
    try {
      outcome = { advice: await options.run(item) }
    } catch (error) {
      signal.throwIfAborted()
      outcome = { error: publicError(error, options.failure(item)) }
    }
    signal.throwIfAborted()
    outcomes[index] = outcome
    options.landed?.(item, outcome)
  }
  const workers = Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
    // A cancelled run takes no more items; the first to see the abort rejects the whole run.
    for (let next = queue.shift(); next && !signal.aborted; next = queue.shift()) await runOne(next)
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
