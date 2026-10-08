import type { CodeViewItem } from '@pierre/diffs'
import {
  DiffSide,
  LineKind,
  Priority,
  type ChangeGroup,
  type ChangedFile,
  type Hunk,
  type PullRequest,
} from '../../../shared/domain/types'
import type { PatchHunk, ReviewChanges, SectionUpdate } from '../../../shared/domain/reviewChanges'
import type { PullFileContent } from '../../../shared/domain/fileContent'
import { diffItems, patchItems } from '../../lib/diffItems'

export const UPDATES_GROUP_ID = 'updated-since-review'

/** Where a section's review control sits: after its last edited line. */
export interface SectionTarget {
  hunkId: string
  itemId: string
  path: string
  line: number
  side: DiffSide
  state?: SectionUpdate
}
export type SyntheticItemKind = 'interdiff' | 'removed'
export interface ReviewItems {
  items: CodeViewItem<undefined>[]
  /** The review sections each displayed item stands for, in display order. */
  sections: Map<string, string[]>
  targets: SectionTarget[]
  synthetic: Map<string, SyntheticItemKind>
}

/** Every update since the previous review, gathered in one group pinned above the others.
 * Its sections are the same hunks as in their regular groups, so viewed state is shared. */
export function updatesGroup(pull: PullRequest, changes?: ReviewChanges): ChangeGroup | undefined {
  if (!changes || (!changes.sections.length && !changes.removed.length)) return undefined
  const updated = new Set(changes.sections.map((section) => section.hunkId))
  const grouped = [...new Set(pull.groups.flatMap((group) => group.hunkIds))]
  const hunkIds = [
    ...grouped.filter((id) => updated.has(id)),
    ...[...updated].filter((id) => !grouped.includes(id)),
  ]
  return {
    id: UPDATES_GROUP_ID,
    title: 'Updated since your review',
    priority: Priority.high,
    reason: `Compared with ${changes.baselineHeadSha.slice(0, 7)}`,
    hunkIds,
    fileIds: pull.files
      .filter((file) => file.hunks.some((hunk) => updated.has(hunk.id)))
      .map((file) => file.id),
  }
}

export function updateCount(changes?: ReviewChanges): number {
  return (changes?.sections.length ?? 0) + (changes?.removed.length ?? 0)
}

type ItemOptions = {
  pull: PullRequest
  displayPull: PullRequest
  group: ChangeGroup
  contents?: ReadonlyMap<string, PullFileContent>
  changes?: ReviewChanges
  full: boolean
}

/** A regular group shows its PR hunks. The updates group shows, per file, new sections as PR hunks,
 * edited sections as what changed since the review unless `full` is set, then dropped edits. */
export function reviewItems(options: ItemOptions): ReviewItems {
  const updates = options.group.id === UPDATES_GROUP_ID ? options.changes : undefined
  const result: ReviewItems = { items: [], sections: new Map(), targets: [], synthetic: new Map() }
  const interdiffs = new Map(
    (options.full ? [] : (updates?.sections ?? [])).flatMap((section) =>
      section.interdiff ? [[section.hunkId, section.interdiff] as const] : [],
    ),
  )
  const states = new Map(
    options.changes?.sections.map((section) => [section.hunkId, section.state]),
  )
  for (const file of options.pull.files.filter((file) => options.group.fileIds.includes(file.id)))
    addFileItems(result, options, file, { interdiffs, states })
  for (const [path, removed] of removedByPath(updates))
    for (const [index, run] of nonOverlapping(removed).entries())
      addPatchItems(result, {
        pull: options.pull,
        id: `removed:${path}:${index}`,
        path,
        kind: 'removed',
        run,
      })
  return result
}

function addFileItems(
  result: ReviewItems,
  options: ItemOptions,
  file: ChangedFile,
  updates: { interdiffs: Map<string, PatchHunk>; states: Map<string, SectionUpdate> },
) {
  const { group } = options
  const hunks = file.hunks.filter((hunk) => group.hunkIds.includes(hunk.id))
  const regular = hunks.filter((hunk) => !updates.interdiffs.has(hunk.id))
  const ids = regular.map((hunk) => hunk.id)
  const items = ids.length
    ? diffItems(
        options.displayPull,
        { ...group, fileIds: [file.id], hunkIds: ids },
        options.contents,
      )
    : []
  for (const item of items) {
    result.items.push(item)
    result.sections.set(item.id, ids)
    for (const hunk of regular)
      result.targets.push(hunkTarget(file, hunk, updates.states.get(hunk.id)))
  }
  const edited = hunks.flatMap((hunk) => {
    const patch = updates.interdiffs.get(hunk.id)
    return patch ? [{ hunk, patch, state: updates.states.get(hunk.id) }] : []
  })
  for (const [index, run] of nonOverlapping(edited).entries())
    addPatchItems(result, {
      pull: options.pull,
      id: `${file.id}:since-review:${index}`,
      path: file.path,
      kind: 'interdiff',
      run,
    })
}

function addPatchItems(
  result: ReviewItems,
  source: {
    pull: PullRequest
    id: string
    path: string
    kind: SyntheticItemKind
    run: { patch: PatchHunk; hunk?: Hunk; state?: SectionUpdate }[]
  },
) {
  const { id, path, run } = source
  const items = patchItems({
    id,
    path,
    hunks: run.map(({ patch }) => patch),
    cacheKey: `${source.pull.id}:${id}`,
  })
  for (const item of items) {
    result.items.push(item)
    result.synthetic.set(item.id, source.kind)
    result.sections.set(
      item.id,
      run.flatMap(({ hunk }) => (hunk ? [hunk.id] : [])),
    )
    for (const { hunk, patch, state } of run)
      if (hunk)
        result.targets.push({
          ...patchTarget(patch),
          hunkId: hunk.id,
          itemId: item.id,
          path,
          ...(state ? { state } : {}),
        })
  }
}

function removedByPath(changes?: ReviewChanges) {
  const paths = new Map<string, { patch: PatchHunk }[]>()
  for (const section of [...(changes?.removed ?? [])].sort((a, b) => a.line - b.line)) {
    const entries = paths.get(section.path) ?? []
    entries.push({ patch: section.hunk })
    paths.set(section.path, entries)
  }
  return paths
}

/** Sections split from one Git hunk share context, so their display-only hunks overlap. Join them
 * when the overlap is only that context; anything else goes in a separate item. */
function nonOverlapping<T extends { patch: PatchHunk }>(values: T[]): T[][] {
  const runs: T[][] = []
  for (const value of values) {
    const last = runs.at(-1)
    const previous = last?.at(-1)
    const patch = previous && withoutSharedContext(previous.patch, value.patch)
    if (last && patch) last.push({ ...value, patch })
    else runs.push([value])
  }
  return runs
}
function withoutSharedContext(previous: PatchHunk, next: PatchHunk): PatchHunk | undefined {
  const before = patchRanges(previous)
  const after = patchRanges(next)
  const overlap = Math.max(0, before.oldEnd - after.oldStart, before.newEnd - after.newStart)
  const shared = next.lines.slice(0, overlap)
  const lines = next.lines.slice(overlap)
  if (shared.some((line) => line.kind !== LineKind.context)) return undefined
  if (!lines.some((line) => line.kind !== LineKind.context)) return undefined
  const oldStart = after.oldStart + overlap
  const newStart = after.newStart + overlap
  const oldCount = lines.filter((line) => line.kind !== LineKind.added).length
  const newCount = lines.filter((line) => line.kind !== LineKind.removed).length
  return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines }
}
function patchRanges(patch: PatchHunk) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patch.header)
  const oldStart = Number(match?.[1] ?? 0)
  const newStart = Number(match?.[3] ?? 0)
  return {
    oldStart,
    newStart,
    oldEnd: oldStart + Number(match?.[2] ?? 1),
    newEnd: newStart + Number(match?.[4] ?? 1),
  }
}

function hunkTarget(file: ChangedFile, hunk: Hunk, state?: SectionUpdate): SectionTarget {
  const line = hunk.lines.findLast((line) => line.kind !== LineKind.context)
  const left = line?.kind === LineKind.removed
  return {
    hunkId: hunk.id,
    itemId: file.id,
    path: file.path,
    line: (left ? line.oldLine : line?.newLine) ?? 1,
    side: left ? DiffSide.left : DiffSide.right,
    ...(state ? { state } : {}),
  }
}
function patchTarget(patch: PatchHunk): { line: number; side: DiffSide } {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(patch.header)
  let oldLine = Number(match?.[1] ?? 1)
  let newLine = Number(match?.[2] ?? 1)
  let target = { line: newLine, side: DiffSide.right }
  for (const line of patch.lines) {
    if (line.kind === LineKind.removed) target = { line: oldLine, side: DiffSide.left }
    if (line.kind === LineKind.added) target = { line: newLine, side: DiffSide.right }
    if (line.kind !== LineKind.added) oldLine++
    if (line.kind !== LineKind.removed) newLine++
  }
  return target
}
