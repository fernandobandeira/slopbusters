import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import {
  DiffSide,
  type DraftComment,
  type PullRequest,
  type PullDiscussions,
  type ReviewThread,
  type ChangeGroup,
} from '../../../../shared/domain/types'

export type CommentEditor = Omit<DraftComment, 'body'>
export interface LineDiscussion {
  path: string
  line: number
  side: DiffSide
  threads: ReviewThread[]
  drafts: DraftComment[]
  editingId?: string
}
export function hasDiscussion(discussion: LineDiscussion): boolean {
  return Boolean(
    discussion.threads.length || discussion.drafts.length || discussion.editingId != null,
  )
}
export function groupViewed(group: ChangeGroup, viewedFileIds: readonly string[]): boolean {
  return group.fileIds.length > 0 && group.fileIds.every((id) => viewedFileIds.includes(id))
}
export function nextUnviewedGroup(params: {
  groups: readonly ChangeGroup[]
  selectedGroupId: string
  viewedFileIds: readonly string[]
}): ChangeGroup | undefined {
  const selectedIndex = params.groups.findIndex((group) => group.id === params.selectedGroupId)
  if (selectedIndex < 0) return undefined
  for (let offset = 1; offset < params.groups.length; offset++) {
    const group = params.groups[(selectedIndex + offset) % params.groups.length]
    if (group && !groupViewed(group, params.viewedFileIds)) return group
  }
  return undefined
}
export function discussionGroup(params: {
  pull: PullRequest
  path: string
  line?: number
  side?: DiffSide
}): ChangeGroup | undefined {
  const file = params.pull.files.find((file) => file.path === params.path)
  if (!file) return undefined
  const groups = params.pull.groups.filter((group) => group.fileIds.includes(file.id))
  const { line, side } = params
  if (line != null && side != null) {
    const matched = groups.find((group) =>
      file.hunks.some(
        (hunk) =>
          group.hunkIds.includes(hunk.id) &&
          hunk.lines.some((candidate) =>
            side === DiffSide.left ? candidate.oldLine === line : candidate.newLine === line,
          ),
      ),
    )
    if (matched) return matched
  }
  return groups[0]
}
function controlledItemVersion(item: CodeViewItem<LineDiscussion>): number {
  // CodeView ignores controlled payload changes with an unchanged version. A content signature
  // publishes discussion edits without producing new versions for equivalent React renders.
  const content = JSON.stringify(item)
  let low = 2166136261
  let high = 3335557771
  for (let index = 0; index < content.length; index++) {
    const character = content.charCodeAt(index)
    low = Math.imul(low ^ character, 16777619)
    high = Math.imul(high ^ character, 2246822519)
  }
  return (high & 0x1fffff) * 0x100000000 + (low >>> 0)
}
type AnnotationParams = {
  items: CodeViewItem<undefined>[]
  pull: PullRequest
  discussions?: PullDiscussions
  comments: DraftComment[]
  editor: CommentEditor | null
}
type Place = (line: number, side: DiffSide) => LineDiscussion | undefined

export function annotateDiscussions(params: AnnotationParams): {
  items: CodeViewItem<LineDiscussion>[]
  unplaced: ReviewThread[]
} {
  const selectedFiles = params.items.map((item) =>
    params.pull.files.find((file) => file.id === item.id),
  )
  const threads =
    params.discussions?.threads.filter((thread) =>
      selectedFiles.some((file) => file?.path === thread.path),
    ) ?? []
  const canMap =
    params.discussions?.headSha === params.pull.headSha &&
    params.discussions?.baseSha === params.pull.baseSha
  const placed = new Set<string>()
  const items = params.items.map((item): CodeViewItem<LineDiscussion> => {
    if (item.type !== 'diff') return { ...item, annotations: [] }
    const file = params.pull.files.find((file) => file.id === item.id)
    const path = file?.path ?? item.fileDiff.name
    const available = availableLines(item.fileDiff.hunks)
    const coordinates = new Map<string, LineDiscussion>()
    // Only attach to lines in this group's partial patch, with the original/updated side intact.
    const at: Place = (line, side) => {
      const key = `${side}:${line}`
      if (!available.has(key)) return undefined
      const value = coordinates.get(key) ?? {
        path,
        line,
        side,
        threads: [],
        drafts: [],
      }
      coordinates.set(key, value)
      return value
    }
    // Display-only items have no PR file, so discussions never attach to them.
    if (file) {
      for (const thread of canMap ? threads : []) {
        if (thread.path !== file.path || thread.outdated || thread.line == null) continue
        const target = at(thread.line, thread.side)
        target?.threads.push(thread)
        if (target) placed.add(thread.id)
      }
      placeDrafts(params, file.path, at)
    }
    const annotations: DiffLineAnnotation<LineDiscussion>[] = [...coordinates.values()].map(
      (metadata) => ({
        lineNumber: metadata.line,
        side: metadata.side === DiffSide.left ? 'deletions' : 'additions',
        metadata,
      }),
    )
    return { ...item, annotations }
  })
  return {
    items: items.map((item) => ({ ...item, version: controlledItemVersion(item) })),
    unplaced: threads.filter((thread) => !placed.has(thread.id)),
  }
}

function availableLines(
  hunks: {
    deletionStart: number
    deletionCount: number
    additionStart: number
    additionCount: number
  }[],
) {
  const available = new Set<string>()
  for (const hunk of hunks) {
    for (let offset = 0; offset < hunk.deletionCount; offset++)
      available.add(`${DiffSide.left}:${hunk.deletionStart + offset}`)
    for (let offset = 0; offset < hunk.additionCount; offset++)
      available.add(`${DiffSide.right}:${hunk.additionStart + offset}`)
  }
  return available
}
function placeDrafts(params: AnnotationParams, path: string, at: Place) {
  const current = (value: { headSha: string; path: string }) =>
    value.headSha === params.pull.headSha && value.path === path
  for (const comment of params.comments.filter(current))
    at(comment.line, comment.side)?.drafts.push(comment)
  const editor = params.editor
  if (!editor || !current(editor)) return
  const target = at(editor.line, editor.side)
  if (target) target.editingId = editor.id
}
