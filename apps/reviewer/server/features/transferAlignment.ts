/** A line compared without its indentation. */
export interface Line {
  text: string
  /** The text without leading or trailing whitespace. */
  key: string
  /** Real code rather than a blank line or bare punctuation; only these anchor a match. */
  meaningful: boolean
  /** Line number in its own revision. */
  number: number
  id: string | undefined
}
/** Matched [source, destination] line indexes. */
export type Pair = readonly [number, number]
/** Line comparisons the fuzzy matcher may still spend in this pull request. */
export interface Budget {
  remaining: number
}

const MIN_ANCHORS = 4
/** Unmatched lines between anchors that are still aligned line by line. */
const MAX_FILLED_GAP = 6
/** Lines next to an anchor searched for matching braces and blank lines across a wider gap. */
const EDGE_WINDOW = 3
/** A line this common in a source cannot seed an exact match. */
const MAX_SEED_OCCURRENCES = 50

/**
 * Aligns a destination run with a source in order. Sources sharing too few lines of real code are
 * skipped without comparing them. While the budget lasts, the longest common subsequence of their
 * real code anchors the alignment and the braces and blank lines between anchors are aligned
 * around it; past the budget, only identical runs of lines are found.
 */
export function alignLines(source: Line[], destination: Line[], budget: Budget): Pair[][] {
  const sourceKeys = meaningfulKeys(source)
  const destinationKeys = meaningfulKeys(destination)
  const sourceAnchors = anchorIndexes(source, destinationKeys)
  const destinationAnchors = anchorIndexes(destination, sourceKeys)
  if (destinationAnchors.length < MIN_ANCHORS) return []
  const cost = sourceAnchors.length * destinationAnchors.length
  if (cost > budget.remaining) return identicalRuns(source, destination)
  budget.remaining -= cost
  const anchors = commonSubsequence(
    sourceAnchors.map((index) => source[index]?.key ?? ''),
    destinationAnchors.map((index) => destination[index]?.key ?? ''),
  ).map(([left, right]): Pair => [sourceAnchors[left] ?? 0, destinationAnchors[right] ?? 0])
  if (anchors.length < MIN_ANCHORS) return []
  return [fillGaps(source, destination, anchors)]
}

function fillGaps(source: Line[], destination: Line[], anchors: Pair[]): Pair[] {
  const pairs: Pair[] = []
  let previous: Pair = [-1, -1]
  for (const anchor of [...anchors, [source.length, destination.length] as const]) {
    const between = { source, destination, previous, next: anchor }
    pairs.push(...alignGap(between))
    if (anchor[0] < source.length) pairs.push(anchor)
    previous = anchor
  }
  return pairs
}

/** Aligns a short gap completely, and only the lines next to its anchors across a long one. */
function alignGap(gap: { source: Line[]; destination: Line[]; previous: Pair; next: Pair }) {
  const { source, destination, previous, next } = gap
  const [sourceFrom, destinationFrom] = [previous[0] + 1, previous[1] + 1]
  const [sourceTo, destinationTo] = next
  const window = (from: Pair, to: Pair) =>
    commonSubsequence(
      source.slice(from[0], to[0]).map((line) => line.key),
      destination.slice(from[1], to[1]).map((line) => line.key),
    ).map(([left, right]): Pair => [from[0] + left, from[1] + right])
  if (sourceTo - sourceFrom <= MAX_FILLED_GAP && destinationTo - destinationFrom <= MAX_FILLED_GAP)
    return window([sourceFrom, destinationFrom], next)
  const head =
    previous[0] < 0
      ? []
      : window(
          [sourceFrom, destinationFrom],
          [
            Math.min(sourceFrom + EDGE_WINDOW, sourceTo),
            Math.min(destinationFrom + EDGE_WINDOW, destinationTo),
          ],
        )
  const afterHead = head.at(-1) ?? previous
  const tail =
    sourceTo >= source.length
      ? []
      : window(
          [
            Math.max(sourceTo - EDGE_WINDOW, afterHead[0] + 1),
            Math.max(destinationTo - EDGE_WINDOW, afterHead[1] + 1),
          ],
          next,
        )
  return [...head, ...tail]
}

/** Runs of identical lines, seeded only by real code that is not too common in the source. */
function identicalRuns(source: Line[], destination: Line[]): Pair[][] {
  const positions = new Map<string, number[]>()
  source.forEach((line, index) => {
    if (!line.meaningful) return
    const known = positions.get(line.key)
    if (known) known.push(index)
    else positions.set(line.key, [index])
  })
  const same = (left: number, right: number) => {
    const key = source[left]?.key
    return key != null && key === destination[right]?.key
  }
  const starts = new Set<string>()
  const runs: Pair[][] = []
  destination.forEach((line, destinationIndex) => {
    const seeds = positions.get(line.key) ?? []
    if (!line.meaningful || seeds.length > MAX_SEED_OCCURRENCES) return
    for (const seed of seeds) {
      let [left, right] = [seed, destinationIndex]
      while (same(left - 1, right - 1)) [left, right] = [left - 1, right - 1]
      if (starts.has(`${left}:${right}`)) continue
      starts.add(`${left}:${right}`)
      const run: Pair[] = []
      while (same(left + run.length, right + run.length))
        run.push([left + run.length, right + run.length])
      if (run.length >= MIN_ANCHORS) runs.push(run)
    }
  })
  return runs
}

/** The longest common subsequence of two key lists, as index pairs in order. */
function commonSubsequence(left: string[], right: string[]): Pair[] {
  const width = right.length + 1
  // An LCS is never longer than the shorter list, which the budget keeps far below 65536.
  const lengths = new Uint16Array((left.length + 1) * width)
  const at = (row: number, column: number) => lengths[row * width + column] ?? 0
  for (let row = left.length - 1; row >= 0; row--)
    for (let column = right.length - 1; column >= 0; column--)
      lengths[row * width + column] =
        left[row] === right[column]
          ? at(row + 1, column + 1) + 1
          : Math.max(at(row + 1, column), at(row, column + 1))
  const pairs: Pair[] = []
  let [row, column] = [0, 0]
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      pairs.push([row, column])
      row++
      column++
    } else if (at(row + 1, column) >= at(row, column + 1)) row++
    else column++
  }
  return pairs
}

function meaningfulKeys(lines: Line[]): Set<string> {
  return new Set(lines.flatMap((line) => (line.meaningful ? [line.key] : [])))
}

function anchorIndexes(lines: Line[], keys: Set<string>): number[] {
  return lines.flatMap((line, index) => (line.meaningful && keys.has(line.key) ? [index] : []))
}
