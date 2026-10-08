import {
  DiffSide,
  LineKind,
  type PullRequest,
  type ReviewDraft,
} from '../../../shared/domain/types'
import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import type { ReviewLocation } from '../../../shared/domain/review'

export function nextUpdatedLocation(
  pull: PullRequest,
  changes: ReviewChanges | undefined,
  draft: ReviewDraft,
  cursor: { groupId?: string; location?: ReviewLocation } = {},
): ReviewLocation | undefined {
  const updated = new Set(changes?.sections.map((section) => section.hunkId))
  const index = Math.max(
    0,
    pull.groups.findIndex((group) => group.id === cursor.groupId),
  )
  const groups = [...pull.groups.slice(index), ...pull.groups.slice(0, index)]
  const ids = groups.flatMap((group) => group.hunkIds).filter((id) => updated.has(id))
  const pending = ids.filter((id) => !draft.viewedHunkIds?.includes(id))
  const ordered = pending.length ? pending : ids
  const current = ordered.findIndex((id) =>
    pull.files.some(
      (file) =>
        file.path === cursor.location?.path &&
        file.hunks.some(
          (hunk) =>
            hunk.id === id &&
            hunk.lines.some(
              (line) =>
                line.kind !== LineKind.context &&
                (cursor.location?.side === DiffSide.left ? line.oldLine : line.newLine) ===
                  cursor.location?.line,
            ),
        ),
    ),
  )
  const id = ordered[(current + 1) % ordered.length]
  const file = pull.files.find((file) => file.hunks.some((hunk) => hunk.id === id))
  const line = file?.hunks
    .find((hunk) => hunk.id === id)
    ?.lines.find((line) => line.kind !== LineKind.context)
  if (!file || !line) return undefined
  return {
    path: file.path,
    line: line.newLine ?? line.oldLine ?? 1,
    side: line.newLine == null ? DiffSide.left : DiffSide.right,
  }
}
