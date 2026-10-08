import type { ChangeGroup, PullRequest, ReviewDraft } from '../../../shared/domain/types'

export function reviewedHunkIds(pull: PullRequest, draft: ReviewDraft): Set<string> {
  return new Set(
    draft.viewedHunkIds ??
      pull.files
        .filter((file) => draft.viewedFileIds.includes(file.id))
        .flatMap((file) => file.hunks.map((hunk) => hunk.id)),
  )
}

export function groupIsViewed(group: ChangeGroup, draft: ReviewDraft, pull?: PullRequest): boolean {
  // A group of only dropped edits has no PR section left to view.
  if (!group.hunkIds.length && !group.fileIds.length) return true
  if (
    pull &&
    group.fileIds.some((id) => {
      const file = pull.files.find((file) => file.id === id)
      return (!file || file.hunks.length === 0) && !draft.viewedFileIds.includes(id)
    })
  )
    return false
  if (group.hunkIds.length && draft.viewedHunkIds) {
    return group.hunkIds.every((id) => draft.viewedHunkIds?.includes(id))
  }
  return group.fileIds.length > 0 && group.fileIds.every((id) => draft.viewedFileIds.includes(id))
}

export function nextUnreviewedGroup(
  groups: ChangeGroup[],
  selectedId: string,
  draft: ReviewDraft,
  pull?: PullRequest,
) {
  const index = groups.findIndex((group) => group.id === selectedId)
  if (index < 0) return undefined
  for (let offset = 1; offset < groups.length; offset++) {
    const group = groups[(index + offset) % groups.length]
    if (group && !groupIsViewed(group, draft, pull)) return group
  }
  return undefined
}

/** The checkbox marks only this file's sections in the current group. */
export function toggleViewedSections(
  pull: PullRequest,
  draft: ReviewDraft,
  hunkIds: string[],
): ReviewDraft {
  const reviewed = reviewedHunkIds(pull, draft)
  const markingViewed = !hunkIds.every((id) => reviewed.has(id))
  for (const id of hunkIds) {
    if (markingViewed) reviewed.add(id)
    else reviewed.delete(id)
  }
  return {
    ...draft,
    viewedHunkIds: [...reviewed],
    viewedFileIds: pull.files
      .filter((file) => file.hunks.length > 0 && file.hunks.every((hunk) => reviewed.has(hunk.id)))
      .map((file) => file.id),
  }
}
