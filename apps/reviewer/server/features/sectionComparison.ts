import { createHash } from 'node:crypto'
import { LineKind, type ChangedFile, type Hunk, type PullRequest } from '../../shared/domain/types'
import type { ReviewChanges, SectionUpdate } from '../../shared/domain/reviewChanges'

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
  const updates: ReviewChanges['sections'] = []
  const sameBase =
    (previous.mergeBaseSha ?? previous.baseSha) === (current.mergeBaseSha ?? current.baseSha)
  const unresolved: Section[] = []
  const byContent = indexSections(before, (section) => section.content)
  const byEvidence = indexSections(before, (section) => section.content + section.context)
  const evidenceCounts = counts(after.map((section) => section.content + section.context))
  const contentCounts = counts(after.map((section) => section.content))
  for (const section of after) {
    const evidence =
      evidenceCounts.get(section.content + section.context) === 1
        ? unique(byEvidence.get(section.content + section.context) ?? [])
        : undefined
    const content =
      contentCounts.get(section.content) === 1
        ? unique(byContent.get(section.content) ?? [])
        : undefined
    const exact = evidence ?? content
    if (exact) {
      matched.add(exact)
      if (exact.context !== section.context)
        updates.push({ hunkId: section.hunk.id, state: 'context-changed' })
    } else unresolved.push(section)
  }
  for (const section of unresolved) {
    const candidates = before.filter(
      (old) =>
        !matched.has(old) &&
        sameFile(old, section) &&
        ((sameBase && overlaps(old.hunk, section.hunk)) || sharedAnchor(old, section)),
    )
    const old = unique(candidates)
    const state: SectionUpdate = old ? 'changed' : 'new'
    if (old) matched.add(old)
    updates.push({ hunkId: section.hunk.id, state })
  }
  return {
    baselineHeadSha: previous.headSha,
    baselineBaseSha: previous.baseSha,
    sections: updates,
    incompletePaths: [
      ...new Set(
        [...previous.files, ...current.files]
          .filter((file) => file.coverage !== 'complete')
          .map((file) => file.path),
      ),
    ],
    removed: before
      .filter(
        (section) =>
          !matched.has(section) &&
          !current.files.some(
            (file) => file.path === section.file.path && file.coverage !== 'complete',
          ),
      )
      .map(({ file, hunk }) => ({
        path: file.path,
        line: hunk.lines.find((line) => line.oldLine != null)?.oldLine ?? 1,
        code: hunk.lines
          .filter((line) => line.kind !== LineKind.context)
          .map((line) => `${line.kind === LineKind.added ? '+' : '-'}${line.text}`)
          .join('\n'),
      })),
  }
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
