import { LineKind, type DiffLine, type Hunk, type PullRequest, type ReviewDraft } from './types'

/** Keep replacement pairs together. Context and blank lines in pure additions/deletions
 * provide deterministic boundaries that the organizer can combine by behavior. */
export function splitChangeSections(hunk: Hunk): Hunk[] {
  if (hunk.sourceHunkId) return [hunk]
  const runs = changedRanges(hunk.lines)
  if (!runs.length) return [hunk]
  return runs.map(([start, end], index) => {
    const previousEnd = runs[index - 1]?.[1] ?? 0
    const nextStart = runs[index + 1]?.[0] ?? hunk.lines.length
    const before = Math.max(previousEnd, start - 3)
    const after = Math.min(nextStart, end + 3)
    // Share unchanged context with neighboring sections; never include their edits.
    const lines = hunk.lines
      .slice(before, after)
      .filter((line, offset) =>
        before + offset >= start && before + offset < end ? true : line.kind === LineKind.context,
      )
    const id = runs.length === 1 ? hunk.id : `${hunk.id}/s${index}`
    return { ...hunk, id, sourceHunkId: hunk.id, lines, header: sectionHeader(hunk, lines) }
  })
}

function changedRanges(lines: DiffLine[]): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  while (start < lines.length) {
    if (lines[start]?.kind === LineKind.context) {
      start++
      continue
    }
    let end = start + 1
    while (end < lines.length && lines[end]?.kind !== LineKind.context) end++
    const run = lines.slice(start, end)
    const replacement =
      run.some((line) => line.kind === LineKind.added) &&
      run.some((line) => line.kind === LineKind.removed)
    if (replacement) ranges.push([start, end])
    else ranges.push(...paragraphRanges(lines, start, end))
    start = end
  }
  return ranges
}

function paragraphRanges(lines: DiffLine[], start: number, end: number): [number, number][] {
  const ranges: [number, number][] = []
  let from = start
  for (let index = start; index < end - 1; index++) {
    if (lines[index]?.text.trim() !== '' || index === from) continue
    ranges.push([from, index + 1])
    from = index + 1
  }
  ranges.push([from, end])
  return ranges
}

function sectionHeader(hunk: Hunk, lines: DiffLine[]): string {
  const original = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.header)
  const first = lines[0] ? hunk.lines.indexOf(lines[0]) : 0
  const prefix = hunk.lines.slice(0, first)
  const oldCount = lines.filter((line) => line.kind !== LineKind.added).length
  const newCount = lines.filter((line) => line.kind !== LineKind.removed).length
  const oldStart =
    Number(original?.[1] ?? 0) + prefix.filter((line) => line.kind !== LineKind.added).length
  const newStart =
    Number(original?.[2] ?? 0) + prefix.filter((line) => line.kind !== LineKind.removed).length
  // A zero-length side names the line BEFORE an insertion/deletion.
  return `@@ -${oldCount ? oldStart || 1 : Math.max(0, oldStart - (Number(original?.[1]) > 0 ? 1 : 0))},${oldCount} +${newCount ? newStart || 1 : Math.max(0, newStart - (Number(original?.[2]) > 0 ? 1 : 0))},${newCount} @@`
}

export function sectionedPull(pull: PullRequest): PullRequest {
  const ids = new Map<string, string[]>()
  const files = pull.files.map((file) => ({
    ...file,
    hunks: file.hunks.flatMap((hunk) => {
      const sections = splitChangeSections(hunk)
      ids.set(
        hunk.id,
        sections.map((section) => section.id),
      )
      return sections
    }),
  }))
  return {
    ...pull,
    files,
    groups: pull.groups.map((group) => ({
      ...group,
      hunkIds: group.hunkIds.flatMap((id) => ids.get(id) ?? [id]),
    })),
  }
}

export function sectionedDraft(pull: PullRequest, draft: ReviewDraft): ReviewDraft {
  if (!draft.viewedHunkIds) return draft
  const viewed = new Set(draft.viewedHunkIds)
  return {
    ...draft,
    viewedHunkIds: pull.files
      .flatMap((file) => file.hunks)
      .filter((hunk) => viewed.has(hunk.id) || (hunk.sourceHunkId && viewed.has(hunk.sourceHunkId)))
      .map((hunk) => hunk.id),
  }
}
