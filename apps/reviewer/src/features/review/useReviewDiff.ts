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
  const { shownViewed, toggleViewedShown, showViewedSections } = useShownViewedSections(
    selected?.id,
  )
  const filters = useVisibleGroup({ pull, selected, viewedHunks, shownViewed })
  const { visibleGroup } = filters
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
  const { display, items } = useReviewItems({
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
  const viewedToggles = useMemo(
    () => viewedSectionToggles(display, filters.partlyViewed, shownViewed, selected?.id),
    [display, filters.partlyViewed, shownViewed, selected?.id],
  )
  return {
    ...progress,
    ...filters,
    ...actions,
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
    viewedToggles,
    toggleViewedShown,
    showViewedSections,
  }
}

function useVisibleGroup(options: {
  pull: PullRequest
  selected?: ChangeGroup
  viewedHunks: Set<string>
  shownViewed: Set<string>
}) {
  const { pull, selected, viewedHunks, shownViewed } = options
  const visible = useMemo(
    () =>
      selected &&
      visibleSections(pull, selected, viewedHunks, (fileId) =>
        shownViewed.has(`${selected.id}/${fileId}`),
      ),
    [pull, selected, viewedHunks, shownViewed],
  )
  return {
    visibleGroup: visible?.group,
    partlyViewed: visible?.partlyViewed ?? new Map<string, number>(),
  }
}

/** Viewed sections stay out of the way while a file has new ones to read. A fully viewed file keeps
 * every section so it can be reopened as a whole. */
function visibleSections(
  pull: PullRequest,
  group: ChangeGroup,
  viewed: Set<string>,
  viewedShown: (fileId: string) => boolean,
) {
  const partlyViewed = new Map<string, number>()
  const hidden = new Set<string>()
  for (const file of pull.files.filter((file) => group.fileIds.includes(file.id))) {
    const ids = file.hunks.filter((hunk) => group.hunkIds.includes(hunk.id)).map((hunk) => hunk.id)
    const seen = ids.filter((id) => viewed.has(id))
    if (!seen.length || seen.length === ids.length) continue
    partlyViewed.set(file.id, seen.length)
    if (!viewedShown(file.id)) seen.forEach((id) => hidden.add(id))
  }
  return {
    group: { ...group, hunkIds: group.hunkIds.filter((id) => !hidden.has(id)) },
    partlyViewed,
  }
}

function useShownViewedSections(selectedId?: string) {
  const [shownViewed, setShownViewed] = useState(() => new Set<string>())
  function showViewedSections(fileId: string, shown: boolean, groupId = selectedId) {
    setShownViewed((previous) => {
      const next = new Set(previous)
      if (shown) next.add(`${groupId}/${fileId}`)
      else next.delete(`${groupId}/${fileId}`)
      return next
    })
  }
  function toggleViewedShown(fileId: string) {
    showViewedSections(fileId, !shownViewed.has(`${selectedId}/${fileId}`))
  }
  return { shownViewed, toggleViewedShown, showViewedSections }
}

export interface ViewedToggle {
  fileId: string
  count: number
  shown: boolean
}

/** The show/hide control for a file's viewed sections sits on the first item drawn for that file. */
function viewedSectionToggles(
  display: ReviewItems | undefined,
  partlyViewed: Map<string, number>,
  shownViewed: Set<string>,
  groupId?: string,
) {
  const toggles = new Map<string, ViewedToggle>()
  const placed = new Set<string>()
  for (const item of display?.items ?? []) {
    const fileId = [...partlyViewed.keys()].find(
      (id) => item.id === id || item.id.startsWith(`${id}:`),
    )
    if (!fileId || placed.has(fileId)) continue
    placed.add(fileId)
    const count = partlyViewed.get(fileId) ?? 0
    toggles.set(item.id, { fileId, count, shown: shownViewed.has(`${groupId}/${fileId}`) })
  }
  return toggles
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
          })
        : undefined,
    [pull, displayPull, visibleGroup, contents, changes, fullSections],
  )
  const items = useMemo(
    () => collapsedItems(display, viewedHunks, collapseOverrides, selectedId),
    [display, viewedHunks, collapseOverrides, selectedId],
  )
  return { display, items }
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
