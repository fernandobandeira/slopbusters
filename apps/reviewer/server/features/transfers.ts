import {
  LineKind,
  TransferKind,
  type ChangedFile,
  type CodeTransfer,
  type DiffLine,
  type TransferChange,
} from '../../shared/domain/types'
import { MAX_TRANSFER_COMPARISONS } from '../limits'
import { digest } from './diff'
import { alignLines, type Budget, type Line, type Pair } from './transferAlignment'

/** Shortest block worth calling a transfer. */
const MIN_BLOCK_LINES = 4
/** Matched lines of real code a block needs; braces and blank lines prove nothing. */
const MIN_ANCHORS = 4
const MIN_MEANINGFUL_LINES = 3
const MIN_BLOCK_CHARS = 80
/** Share of the longer side of a block that must match the other side, in order. */
const MIN_SIMILARITY = 0.7
/** Unmatched lines in a row, on either side, that end a block. */
const MAX_GAP = 6
/** Context kept around each edit inside a transfer. */
const CHANGE_CONTEXT = 2

interface Sequence {
  path: string
  /** Lines of one patch change region; a removed and added run sharing one are an in-place edit. */
  region?: number
  lines: Line[]
  order: number
}
interface Source extends Sequence {
  kind: TransferKind
  /** Base lines a copy may not start from because the PR deleted them. */
  deleted?: Set<number>
}
interface Block {
  source: Source
  destination: Sequence
  /** Matched [source, destination] line indexes in order; the block spans first to last. */
  pairs: Pair[]
}

/**
 * Finds blocks the PR moved or copied, allowing small edits on the way. Comparing lines without
 * their indentation, a block must match at least 70% of its lines in order and anchor on real code
 * rather than braces. A block that matches removed lines is moved; one that only matches unchanged
 * code of a changed file is copied. The block with the most matched lines claims them first.
 */
export function detectTransfers(files: ChangedFile[]): CodeTransfer[] {
  const removed = files.flatMap((file) => changedRuns(file, LineKind.removed))
  const destinations = files
    .flatMap((file) => changedRuns(file, LineKind.added))
    .map((run, order) => ({ ...run, order }))
  const budget: Budget = { remaining: MAX_TRANSFER_COMPARISONS }
  const claimed = new Set<string>()
  const moves = claimStrongest(
    candidates({ destinations, sources: removed, budget, claimed }),
    claimed,
  )
  const copies = claimStrongest(
    candidates({ destinations, sources: originals(files, removed), budget, claimed }),
    claimed,
  )
  return [...moves, ...copies].sort(byDestination).map(toTransfer)
}

function candidates(input: {
  destinations: Sequence[]
  sources: Source[]
  budget: Budget
  claimed: Set<string>
}): Block[] {
  return input.destinations.flatMap((destination) =>
    input.sources
      .filter((source) => !editedInPlace(source, destination))
      .flatMap((source) =>
        alignLines(source.lines, destination.lines, input.budget).flatMap((pairs) =>
          blocks({ source, destination, pairs }, input.claimed),
        ),
      ),
  )
}

/** Accepts the strongest block first; a block that lost lines to it is cut down and retried. */
function claimStrongest(pending: Block[], claimed: Set<string>): Block[] {
  const accepted: Block[] = []
  let queue = pending
  while (queue.length) {
    queue.sort((left, right) => strength(right) - strength(left))
    const [best, ...rest] = queue
    queue = rest
    if (!best) break
    const { source, destination } = span(best)
    const lineIds = [...source, ...destination].flatMap((line) => (line.id ? [line.id] : []))
    if (lineIds.some((id) => claimed.has(id))) {
      queue.push(...blocks(best, claimed))
      continue
    }
    for (const id of lineIds) claimed.add(id)
    accepted.push(best)
  }
  return accepted
}

/** Cuts an alignment into blocks at claimed or deleted lines and long gaps, then keeps the good ones. */
function blocks(block: Block, claimed: Set<string>): Block[] {
  const isClaimed = (line: Line | undefined) => line?.id != null && claimed.has(line.id)
  const sourceBlocked = (index: number) =>
    isClaimed(block.source.lines[index]) || (block.source.deleted?.has(index) ?? false)
  const destinationBlocked = (index: number) => isClaimed(block.destination.lines[index])
  const pairs = block.pairs.filter(
    ([source, destination]) => !sourceBlocked(source) && !destinationBlocked(destination),
  )
  const segments: Pair[][] = []
  let previous: Pair | undefined
  for (const pair of pairs) {
    const broken =
      !previous ||
      gap(previous, pair) > MAX_GAP ||
      range(previous[0] + 1, pair[0]).some(sourceBlocked) ||
      range(previous[1] + 1, pair[1]).some(destinationBlocked)
    if (broken) segments.push([pair])
    else segments.at(-1)?.push(pair)
    previous = pair
  }
  return segments.flatMap((segment) => refine({ ...block, pairs: segment }))
}

/** Splits a block at its widest gap until it is similar enough, then applies the noise guards. */
function refine(block: Block): Block[] {
  if (block.pairs.length < MIN_ANCHORS) return []
  const { source, destination } = span(block)
  if (block.pairs.length < MIN_SIMILARITY * Math.max(source.length, destination.length)) {
    const widest = widestGap(block.pairs)
    return [
      ...refine({ ...block, pairs: block.pairs.slice(0, widest) }),
      ...refine({ ...block, pairs: block.pairs.slice(widest) }),
    ]
  }
  return worthShowing(block) ? [block] : []
}

function worthShowing(block: Block): boolean {
  const { source, destination } = span(block)
  const anchors = block.pairs.filter(([, index]) => block.destination.lines[index]?.meaningful)
  const sameLocation =
    block.source.kind === TransferKind.copied &&
    block.source.path === block.destination.path &&
    source[0]?.number === destination[0]?.number
  return (
    destination.length >= MIN_BLOCK_LINES &&
    anchors.length >= MIN_ANCHORS &&
    destination.filter((line) => line.text.trim().length > 2).length >= MIN_MEANINGFUL_LINES &&
    destination.map((line) => line.text).join('').length >= MIN_BLOCK_CHARS &&
    !sameLocation
  )
}

function toTransfer(block: Block): CodeTransfer {
  const { source, destination } = span(block)
  const from = source[0]?.number ?? 0
  const to = destination[0]?.number ?? 0
  const changedLines = destination.length - block.pairs.length
  const exact = isExact(block)
  return {
    id: digest(`${block.source.path}:${from}:${block.destination.path}:${to}`),
    kind: block.source.kind,
    fromPath: block.source.path,
    fromLine: from,
    fromEndLine: source.at(-1)?.number ?? from,
    toPath: block.destination.path,
    toLine: to,
    toEndLine: destination.at(-1)?.number ?? to,
    lineCount: destination.length,
    changedLines,
    exact,
    changes: exact ? [] : changeHunks(block),
    sourceLineIds: source.flatMap((line) => (line.id ? [line.id] : [])),
    destinationLineIds: destination.flatMap((line) => (line.id ? [line.id] : [])),
    text: destination.map((line) => line.text).join('\n'),
  }
}

/** The edits inside a block as unified hunks, comparing lines without their indentation. */
function changeHunks(block: Block): TransferChange[] {
  const lines = alignedLines(block)
  const ranges: [number, number][] = []
  lines.forEach((line, index) => {
    if (line.kind === LineKind.context) return
    const from = Math.max(0, index - CHANGE_CONTEXT)
    const to = Math.min(lines.length, index + CHANGE_CONTEXT + 1)
    const last = ranges.at(-1)
    if (last && from <= last[1]) last[1] = to
    else ranges.push([from, to])
  })
  return ranges.map(([from, to]) => changeHunk(lines.slice(from, to)))
}

function alignedLines(block: Block): TransferChange['lines'] {
  const lines: TransferChange['lines'] = []
  const reindent = indentationShift(block)
  let [source, destination] = block.pairs[0] ?? [0, 0]
  for (const [matchedSource, matchedDestination] of block.pairs) {
    for (; source < matchedSource; source++) {
      const line = block.source.lines[source]
      if (line)
        lines.push({
          kind: LineKind.removed,
          text: reindent(line.text),
          oldLine: line.number,
          newLine: null,
        })
    }
    for (; destination < matchedDestination; destination++) {
      const line = block.destination.lines[destination]
      if (line)
        lines.push({ kind: LineKind.added, text: line.text, oldLine: null, newLine: line.number })
    }
    const before = block.source.lines[matchedSource]
    const after = block.destination.lines[matchedDestination]
    if (before && after)
      lines.push({
        kind: LineKind.context,
        text: after.text,
        oldLine: before.number,
        newLine: after.number,
      })
    source = matchedSource + 1
    destination = matchedDestination + 1
  }
  return lines
}

/**
 * Moves removed lines into the destination's indentation, measured on the first matched line of
 * real code, so edits read in one frame. Only leading whitespace is ever added or removed.
 */
function indentationShift(block: Block): (text: string) => string {
  const anchor = block.pairs.find(([source]) => block.source.lines[source]?.meaningful)
  const from = leadingWhitespace(block.source.lines[anchor?.[0] ?? -1]?.text ?? '')
  const to = leadingWhitespace(block.destination.lines[anchor?.[1] ?? -1]?.text ?? '')
  const shift = to.length - from.length
  return (text) => {
    if (text.startsWith(from)) return to + text.slice(from.length)
    if (shift > 0) return to.slice(0, shift) + text
    return text.slice(Math.min(-shift, leadingWhitespace(text).length))
  }
}

function leadingWhitespace(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? ''
}

function changeHunk(lines: TransferChange['lines']): TransferChange {
  const before = lines.filter((line) => line.kind !== LineKind.added)
  const after = lines.filter((line) => line.kind !== LineKind.removed)
  const oldStart = before[0]?.oldLine ?? 0
  const newStart = after[0]?.newLine ?? 0
  return { header: `@@ -${oldStart},${before.length} +${newStart},${after.length} @@`, lines }
}

function isExact(block: Block): boolean {
  const { source, destination } = span(block)
  return source.length === block.pairs.length && destination.length === block.pairs.length
}

function strength(block: Block): number {
  // Ties go to the exact block.
  return block.pairs.length * 2 + (isExact(block) ? 1 : 0)
}

function byDestination(left: Block, right: Block): number {
  return (
    left.destination.order - right.destination.order ||
    (left.pairs[0]?.[1] ?? 0) - (right.pairs[0]?.[1] ?? 0)
  )
}

function span(block: Block): { source: Line[]; destination: Line[] } {
  const first = block.pairs[0]
  const last = block.pairs.at(-1)
  if (!first || !last) return { source: [], destination: [] }
  return {
    source: block.source.lines.slice(first[0], last[0] + 1),
    destination: block.destination.lines.slice(first[1], last[1] + 1),
  }
}

/** The index of the pair after the widest gap. */
function widestGap(pairs: Pair[]): number {
  let widest = 1
  let widestSize = -1
  pairs.forEach((pair, index) => {
    const previous = pairs[index - 1]
    if (!previous) return
    const size = gap(previous, pair)
    if (size > widestSize) [widest, widestSize] = [index, size]
  })
  return widest
}

function gap(previous: Pair, next: Pair): number {
  return Math.max(next[0] - previous[0] - 1, next[1] - previous[1] - 1)
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset)
}

function editedInPlace(source: Source, destination: Sequence): boolean {
  return (
    source.kind === TransferKind.moved &&
    source.path === destination.path &&
    source.region === destination.region
  )
}

/** Copies can originate in unchanged code of a changed file, including context outside its hunks. */
function originals(files: ChangedFile[], removed: Source[]): Source[] {
  return files.flatMap((file, order) => {
    if (file.oldContent == null) return []
    const deleted = new Set(
      removed
        .filter((run) => run.path === file.path)
        .flatMap((run) => run.lines.map((line) => line.number - 1)),
    )
    const lines = file.oldContent
      .split('\n')
      .map((text, index) => toLine(text, index + 1, undefined))
    return [{ kind: TransferKind.copied, path: file.path, lines, order, deleted }]
  })
}

/**
 * Consecutive removed or added lines of a file. Runs continue across sections split from one patch
 * hunk, and a context line or a new patch hunk starts a new change region.
 */
function changedRuns(file: ChangedFile, kind: LineKind): Source[] {
  const runs: Source[] = []
  let region = 0
  let patchHunk: string | undefined
  for (const hunk of file.hunks) {
    if ((hunk.sourceHunkId ?? hunk.id) !== patchHunk) region++
    patchHunk = hunk.sourceHunkId ?? hunk.id
    for (const line of hunk.lines) {
      if (line.kind === LineKind.context) region++
      const number = kind === LineKind.removed ? line.oldLine : line.newLine
      if (line.kind !== kind || number == null) continue
      const last = runs.at(-1)
      const next = toLine(line.text, number, line.id)
      if (last?.region === region && last.lines.at(-1)?.number === number - 1) last.lines.push(next)
      else runs.push({ kind: TransferKind.moved, path: file.path, region, lines: [next], order: 0 })
    }
  }
  return runs
}

function toLine(text: string, number: number, id: DiffLine['id'] | undefined): Line {
  const key = text.trim()
  return { text, key, meaningful: key.length > 2 && !/^[\s{}()[\];,]*$/.test(key), number, id }
}
