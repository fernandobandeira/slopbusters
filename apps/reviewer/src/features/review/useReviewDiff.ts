import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router'
import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import type { PullRequest, ReviewDraft, ChangeGroup } from '../../../shared/domain/types'
import { readReviewView, updateReviewView, type ReviewView } from '../../lib/routes'
import { useFileContext } from './diff/useFileContext'
import {
  groupIsViewed,
  nextUnreviewedGroup,
  reviewedHunkIds,
  toggleViewedSections,
} from './reviewProgress'
import { displayPullWithContext } from './diff/displayContext'
import { reviewItems, updatesGroup, type ReviewItems } from './reviewUpdates'

export function useReviewDiff(
  pull: PullRequest,
  draft: ReviewDraft,
  setDraft: Dispatch<SetStateAction<ReviewDraft>>,
  changes?: ReviewChanges,
) {
  const fileContext = useFileContext(pull.id)
  const loadFileContext = fileContext.load
  const [contextLines, setContextLines] = useState(() => new Map<string, number>())
  const [searchParams, setSearchParams] = useSearchParams()
  const { groupId, split, fullSections } = readReviewView(searchParams)
  const updates = useMemo(() => updatesGroup(pull, changes), [pull, changes])
  const viewedHunks = useMemo(() => reviewedHunkIds(pull, draft), [pull, draft])
  const progress = groupProgress(pull, draft, { groupId, updates })
  const { selected } = progress
  const { collapseOverrides, setFileCollapsed } = useCollapseOverrides(selected?.id)
  // Every group shows all of its sections; the updates group is where only new edits appear.
  const visibleGroup = selected
  function changeView(changes: Partial<ReviewView>) {
    const next = updateReviewView(searchParams, changes)
    if (next.toString() !== searchParams.toString()) setSearchParams(next)
  }
  const displayPull = useMemo(
    () => displayPullWithContext(pull, fileContext.contents, contextLines),
    [pull, fileContext.contents, contextLines],
  )
  useEffect(() => {
    for (const fileId of visibleGroup?.fileIds ?? []) void loadFileContext(fileId).catch(() => {})
  }, [visibleGroup, loadFileContext])
  const { display, items, setFileRevealed } = useReviewItems({
    pull,
    displayPull,
    visibleGroup,
    contents: fileContext.contents,
    changes,
    fullSections,
    viewedHunks,
    collapseOverrides,
    selectedId: selected?.id,
  })
  const actions = fileReviewActions({
    pull,
    draft,
    setDraft,
    groups: progress.groups,
    selected,
    itemSections: display?.sections,
    changeView,
    setFileCollapsed,
  })
  return {
    ...progress,
    ...actions,
    visibleGroup,
    updates,
    grouped: pull.groupingSource !== 'files',
    split,
    fullSections,
    searchParams,
    setSearchParams,
    changeView,
    fileContext,
    contextLines,
    setContextLines,
    items,
    syntheticItems: display?.synthetic ?? new Map<string, never>(),
    setFileCollapsed,
    setFileRevealed,
  }
}

/** A revealed file also shows the edits other groups own, so every gap in it can expand. */
function useRevealedFiles(selectedId?: string) {
  const [revealedFiles, setRevealedFiles] = useState(() => new Set<string>())
  function setFileRevealed(fileId: string, revealed: boolean) {
    const key = `${selectedId}/${fileId}`
    setRevealedFiles((previous) => {
      if (previous.has(key) === revealed) return previous
      const next = new Set(previous)
      if (revealed) next.add(key)
      else next.delete(key)
      return next
    })
  }
  return { revealedFiles, setFileRevealed }
}

function useCollapseOverrides(selectedId?: string) {
  const [collapseOverrides, setCollapseOverrides] = useState(() => new Map<string, boolean>())
  function setFileCollapsed(fileId: string, collapsed: boolean, groupId = selectedId) {
    setCollapseOverrides((previous) => new Map(previous).set(`${groupId}/${fileId}`, collapsed))
  }
  return { collapseOverrides, setFileCollapsed }
}

/** Reviewers mark whole files; the sections behind a file are tracked underneath. */
function fileReviewActions(options: {
  pull: PullRequest
  draft: ReviewDraft
  setDraft: Dispatch<SetStateAction<ReviewDraft>>
  groups: ChangeGroup[]
  selected?: ChangeGroup
  itemSections?: Map<string, string[]>
  changeView: (changes: Partial<ReviewView>) => void
  setFileCollapsed: (fileId: string, collapsed: boolean) => void
}) {
  const { pull, draft, setDraft, groups, selected, changeView } = options
  const viewed = reviewedHunkIds(pull, draft)
  function itemSectionIds(itemId: string) {
    return options.itemSections?.get(itemId) ?? []
  }
  /** Moving on after the last section keeps a reviewer in flow across groups. */
  function advanceIfComplete(nextDraft: ReviewDraft) {
    if (!selected || !groupIsViewed(selected, nextDraft, pull)) return
    const next = nextUnreviewedGroup(groups, selected.id, nextDraft, pull)
    if (next) changeView({ groupId: next.id })
  }
  function toggleFile(itemId: string) {
    if (!selected) return
    const ids = itemSectionIds(itemId)
    if (!ids.length) return
    const nextDraft = toggleViewedSections(pull, draft, ids)
    const markingViewed = ids.every((id) => nextDraft.viewedHunkIds?.includes(id))
    options.setFileCollapsed(itemId, markingViewed)
    setDraft(nextDraft)
    if (markingViewed) advanceIfComplete(nextDraft)
  }
  function fileSectionsViewed(itemId: string) {
    const ids = itemSectionIds(itemId)
    return ids.length > 0 && ids.every((id) => viewed.has(id))
  }
  return { toggleFile, fileSectionsViewed }
}

function groupProgress(
  pull: PullRequest,
  draft: ReviewDraft,
  { groupId, updates }: { groupId?: string; updates?: ChangeGroup },
) {
  const groups =
    pull.groupingSource !== 'files' ? [...(updates ? [updates] : []), ...pull.groups] : []
  const selected =
    groups.find((group) => group.id === groupId) ??
    groups.find((group) => !groupIsViewed(group, draft, pull)) ??
    groups[0]
  return { groups, selected }
}

function useReviewItems(options: {
  pull: PullRequest
  displayPull: PullRequest
  visibleGroup?: ChangeGroup
  contents: ReturnType<typeof useFileContext>['contents']
  changes?: ReviewChanges
  fullSections: boolean
  viewedHunks: Set<string>
  collapseOverrides: Map<string, boolean>
  selectedId?: string
}) {
  const { pull, displayPull, visibleGroup, contents, changes, fullSections } = options
  const { viewedHunks, collapseOverrides, selectedId } = options
  const { revealedFiles, setFileRevealed } = useRevealedFiles(selectedId)
  const display = useMemo(
    () =>
      visibleGroup
        ? reviewItems({
            pull,
            displayPull,
            group: visibleGroup,
            contents,
            changes,
            full: fullSections,
            revealed: (fileId) => revealedFiles.has(`${selectedId}/${fileId}`),
          })
        : undefined,
    [pull, displayPull, visibleGroup, contents, changes, fullSections, revealedFiles, selectedId],
  )
  const items = useMemo(
    () => collapsedItems(display, viewedHunks, collapseOverrides, selectedId),
    [display, viewedHunks, collapseOverrides, selectedId],
  )
  return { display, items, setFileRevealed }
}

function collapsedItems(
  display: ReviewItems | undefined,
  viewedHunks: Set<string>,
  collapseOverrides: Map<string, boolean>,
  groupId?: string,
) {
  return (
    display?.items.map((item) => {
      const ids = display.sections.get(item.id) ?? []
      const viewed = ids.length > 0 && ids.every((id) => viewedHunks.has(id))
      return { ...item, collapsed: collapseOverrides.get(`${groupId}/${item.id}`) ?? viewed }
    }) ?? []
  )
}
