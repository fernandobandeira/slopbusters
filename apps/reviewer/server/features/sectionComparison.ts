import { createHash } from 'node:crypto'
import { diffArrays } from 'diff'
import { LineKind, type ChangedFile, type Hunk, type PullRequest } from '../../shared/domain/types'
import type {
  PatchHunk,
  RemovedSection,
  ReviewChanges,
  SectionChange,
  SectionUpdate,
} from '../../shared/domain/reviewChanges'

type Section = { file: ChangedFile; hunk: Hunk; content: string; context: string }

export function sectionContent(file: ChangedFile, hunk: Hunk): string {
  return hash([
    file.path,
    file.previousPath ?? null,
    file.status,
    hunk.lines
      .filter((line) => line.kind !== LineKind.context)
      .map((line) => [line.kind, line.text]),
  ])
}

/** Use up to three unchanged lines on either side as local context anchors. Extra display context and positions do not. */
export function sectionContext(hunk: Hunk): string {
  const first = hunk.lines.findIndex((line) => line.kind !== LineKind.context)
  const last = hunk.lines.findLastIndex((line) => line.kind !== LineKind.context)
  return hash([
    hunk.lines.slice(Math.max(0, first - 3), first).map((line) => line.text),
    hunk.lines.slice(last + 1, last + 4).map((line) => line.text),
  ])
}

export function compareReviewSections(previous: PullRequest, current: PullRequest): ReviewChanges {
  const before = sections(previous)
  const after = sections(current)
  const matched = new Set<Section>()
  const updates = new Map<Section, SectionChange>()
  const sameBase =
    (previous.mergeBaseSha ?? previous.baseSha) === (current.mergeBaseSha ?? current.baseSha)
  const unresolved: Section[] = []
  const exactMatch = exactMatcher(before, after)
  for (const section of after) {
    const exact = exactMatch(section)
    if (exact) {
      matched.add(exact)
      if (exact.context !== section.context)
        updates.set(section, sectionChange(section, 'context-changed', exact))
    } else unresolved.push(section)
  }
  const leftovers: Section[] = []
  for (const section of unresolved) {
    const candidates = before.filter(
      (old) =>
        !matched.has(old) &&
        sameFile(old, section) &&
        ((sameBase && overlaps(old.hunk, section.hunk)) || sharedAnchor(old, section)),
    )
    const old = unique(candidates)
    if (old) {
      matched.add(old)
      updates.set(section, sectionChange(section, 'changed', old))
    } else leftovers.push(section)
  }
  // Rebases and nearby edits move sections and their anchors. Pair what remains by edit similarity,
  // so a reworded section reads as changed instead of as a new section plus a removed one.
  const unmatched = before.filter((section) => !matched.has(section))
  const paired = new Set<Section>()
  for (const [section, old] of similarPairs(leftovers, unmatched)) {
    matched.add(old)
    paired.add(section)
    // Repeated identical edits are ambiguous to the exact pass but are not updates.
    const state = pairedState(old, section)
    if (state) updates.set(section, sectionChange(section, state, old))
  }
  for (const section of leftovers)
    if (!paired.has(section)) updates.set(section, sectionChange(section, 'new'))
  return {
    baselineHeadSha: previous.headSha,
    baselineBaseSha: previous.baseSha,
    sections: after.flatMap((section) => updates.get(section) ?? []),
    incompletePaths: [
      ...new Set(
        [...previous.files, ...current.files]
          .filter((file) => file.coverage !== 'complete')
          .map((file) => file.path),
      ),
    ],
    removed: removedSections(
      before.filter((section) => !matched.has(section)),
      current,
    ),
  }
}

/** Unmatched reviewed sections, except where the current patch is too incomplete to tell. */
function removedSections(unmatched: Section[], current: PullRequest): RemovedSection[] {
  const incomplete = new Set(
    current.files.filter((file) => file.coverage !== 'complete').map((file) => file.path),
  )
  return unmatched
    .filter((section) => !incomplete.has(section.file.path))
    .map(({ file, hunk }) => ({
      path: file.path,
      line: hunk.lines.find((line) => line.oldLine != null)?.oldLine ?? 1,
      hunk: revertedHunk(hunk),
    }))
}

/** Identical edits correspond when both revisions have exactly one, preferring matching context. */
function exactMatcher(before: Section[], after: Section[]) {
  const evidence = (section: Section) => section.content + section.context
  const byContent = indexSections(before, (section) => section.content)
  const byEvidence = indexSections(before, evidence)
  const evidenceCounts = counts(after.map(evidence))
  const contentCounts = counts(after.map((section) => section.content))
  return (section: Section): Section | undefined => {
    const withContext =
      evidenceCounts.get(evidence(section)) === 1
        ? unique(byEvidence.get(evidence(section)) ?? [])
        : undefined
    if (withContext) return withContext
    return contentCounts.get(section.content) === 1
      ? unique(byContent.get(section.content) ?? [])
      : undefined
  }
}

function pairedState(old: Section, section: Section): SectionUpdate | undefined {
  if (old.content !== section.content) return 'changed'
  return old.context === section.context ? undefined : 'context-changed'
}

function sectionChange(section: Section, state: SectionUpdate, old?: Section): SectionChange {
  const change = old && interdiff(old.hunk, section.hunk)
  return change
    ? { hunkId: section.hunk.id, state, interdiff: change }
    : { hunkId: section.hunk.id, state }
}

/** Compare the new side of both revisions. Context present in only one revision is an artifact of
 * section boundaries, not an edit, so it is trimmed from the edges. */
function interdiff(old: Hunk, current: Hunk): PatchHunk | undefined {
  const before = old.lines.filter((line) => line.kind !== LineKind.removed)
  const after = current.lines.filter((line) => line.kind !== LineKind.removed)
  const parts = diffArrays(before, after, { comparator: (a, b) => a.text === b.text })
  const lines = parts.flatMap((part) =>
    part.value.map((line) => ({
      kind: part.added ? LineKind.added : part.removed ? LineKind.removed : LineKind.context,
      source: line,
      text: line.text,
    })),
  )
  const edge = (line?: (typeof lines)[number]) =>
    line != null && line.kind !== LineKind.context && line.source.kind === LineKind.context
  while (edge(lines[0])) lines.shift()
  while (edge(lines.at(-1))) lines.pop()
  if (!lines.some((line) => line.kind !== LineKind.context)) return undefined
  const oldStart = lines.find((line) => line.kind !== LineKind.added)?.source.newLine
  const newStart = lines.find((line) => line.kind !== LineKind.removed)?.source.newLine
  const patch = lines.map(({ kind, text }) => ({ kind, text }))
  return {
    header: patchHeader(oldStart ?? newSideStart(old), newStart ?? newSideStart(current), patch),
    lines: patch,
  }
}

/** A dropped edit, read from the reviewed revision back to the base it no longer changes. */
function revertedHunk(hunk: Hunk): PatchHunk {
  const lines = unifiedOrder(
    hunk.lines.map((line) => ({
      kind:
        line.kind === LineKind.added
          ? LineKind.removed
          : line.kind === LineKind.removed
            ? LineKind.added
            : LineKind.context,
      text: line.text,
    })),
  )
  const oldStart = hunk.lines.find((line) => line.newLine != null)?.newLine ?? newSideStart(hunk)
  const newStart = hunk.lines.find((line) => line.oldLine != null)?.oldLine ?? oldSideStart(hunk)
  return { header: patchHeader(oldStart, newStart, lines), lines }
}

/** Unified patches list each block's deletions before its additions. */
function unifiedOrder(lines: PatchHunk['lines']): PatchHunk['lines'] {
  const result: PatchHunk['lines'] = []
  let block: PatchHunk['lines'] = []
  const flush = () => {
    result.push(
      ...block.filter((line) => line.kind === LineKind.removed),
      ...block.filter((line) => line.kind === LineKind.added),
    )
    block = []
  }
  for (const line of lines) {
    if (line.kind === LineKind.context) {
      flush()
      result.push(line)
    } else block.push(line)
  }
  flush()
  return result
}

function patchHeader(oldStart: number, newStart: number, lines: PatchHunk['lines']): string {
  const oldCount = lines.filter((line) => line.kind !== LineKind.added).length
  const newCount = lines.filter((line) => line.kind !== LineKind.removed).length
  // A zero-length side names the line before the edit.
  const start = (value: number, count: number) =>
    count ? Math.max(1, value) : Math.max(0, value - 1)
  return `@@ -${start(oldStart, oldCount)},${oldCount} +${start(newStart, newCount)},${newCount} @@`
}
function oldSideStart(hunk: Hunk): number {
  return Number(/^@@ -(\d+)/.exec(hunk.header)?.[1] ?? 1)
}
function newSideStart(hunk: Hunk): number {
  return Number(/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(hunk.header)?.[1] ?? 1)
}

const SIMILARITY_THRESHOLD = 0.6
function similarPairs(sections: Section[], candidates: Section[]): [Section, Section][] {
  const scored = sections
    .flatMap((section) =>
      candidates
        .filter((old) => sameFile(old, section))
        .map((old) => ({ section, old, score: similarity(old.hunk, section.hunk) })),
    )
    .filter((pair) => pair.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
  const used = new Set<Section>()
  const pairs: [Section, Section][] = []
  for (const { section, old } of scored) {
    if (used.has(section) || used.has(old)) continue
    used.add(section)
    used.add(old)
    pairs.push([section, old])
  }
  return pairs
}
/** Dice coefficient over character bigrams of each section's edited lines. */
function similarity(a: Hunk, b: Hunk): number {
  const left = bigrams(a)
  const right = bigrams(b)
  const total = left.length + right.length
  if (!total) return 0
  const available = counts(left)
  let shared = 0
  for (const bigram of right) {
    const count = available.get(bigram) ?? 0
    if (!count) continue
    shared++
    available.set(bigram, count - 1)
  }
  return (2 * shared) / total
}
function bigrams(hunk: Hunk): string[] {
  return hunk.lines
    .filter((line) => line.kind !== LineKind.context && line.text.trim())
    .flatMap((line) => {
      const text = `${line.kind === LineKind.added ? '+' : '-'}${line.text.trim().replace(/\s+/g, ' ')}`
      return Array.from({ length: Math.max(0, text.length - 1) }, (_, index) =>
        text.slice(index, index + 2),
      )
    })
}

function sections(pull: PullRequest): Section[] {
  return pull.files
    .filter((file) => file.coverage === 'complete')
    .flatMap((file) =>
      file.hunks.map((hunk) => ({
        file,
        hunk,
        content: sectionContent(file, hunk),
        context: sectionContext(hunk),
      })),
    )
}
function sameFile(a: Section, b: Section) {
  return (
    a.file.path === b.file.path &&
    a.file.previousPath === b.file.previousPath &&
    a.file.status === b.file.status
  )
}
function sharedAnchor(a: Section, b: Section) {
  return (
    a.context === b.context &&
    a.hunk.lines.some((line) => line.kind === LineKind.context && line.text.trim())
  )
}
function overlaps(a: Hunk, b: Hunk): boolean {
  const left = editRange(a)
  const right = editRange(b)
  return left[0] <= right[1] && right[0] <= left[1]
}
function editRange(hunk: Hunk): [number, number] {
  const removed = hunk.lines
    .filter((line) => line.kind === LineKind.removed)
    .flatMap((line) => (line.oldLine == null ? [] : [line.oldLine]))
  if (removed.length) return [removed[0] ?? 0, removed.at(-1) ?? 0]
  const match = /^@@ -(\d+)/.exec(hunk.header)
  const first = hunk.lines.findIndex((line) => line.kind === LineKind.added)
  const anchor =
    Number(match?.[1] ?? 0) +
    hunk.lines.slice(0, first).filter((line) => line.oldLine != null).length
  return [anchor, anchor]
}
function indexSections(values: Section[], key: (section: Section) => string) {
  const result = new Map<string, Section[]>()
  for (const value of values) {
    const id = key(value)
    const entries = result.get(id) ?? []
    entries.push(value)
    result.set(id, entries)
  }
  return result
}
function counts(values: string[]) {
  const result = new Map<string, number>()
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
  return result
}
function unique<T>(values: T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
