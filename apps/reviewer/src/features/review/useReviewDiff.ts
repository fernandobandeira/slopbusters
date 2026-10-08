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
  const progress = groupProgress(pull, draft, viewedHunks, { groupId, updates })
  const { selected } = progress
  const filters = useVisibleGroup({ selected, viewedHunks, searchParams })
  const { visibleGroup } = filters
  const { collapseOverrides, setFileCollapsed } = useCollapseOverrides(selected?.id)
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
  const actions = sectionReviewActions({
    pull,
    draft,
    setDraft,
    groups: progress.groups,
    selected,
    visibleGroup,
    itemSections: display?.sections,
    changeView,
    setFileCollapsed,
  })
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
    sectionTargets: display?.targets ?? [],
    syntheticItems: display?.synthetic ?? new Map<string, never>(),
    setFileCollapsed,
  }
}

function useVisibleGroup(options: {
  selected?: ChangeGroup
  viewedHunks: Set<string>
  searchParams: URLSearchParams
}) {
  const { selected, viewedHunks, searchParams } = options
  const unviewedOnly = searchParams.get('unviewed') === '1'
  const visibleGroup = useMemo(
    () =>
      selected && {
        ...selected,
        hunkIds: selected.hunkIds.filter((id) => !unviewedOnly || !viewedHunks.has(id)),
      },
    [selected, unviewedOnly, viewedHunks],
  )
  return { visibleGroup, unviewedOnly }
}

function useCollapseOverrides(selectedId?: string) {
  const [collapseOverrides, setCollapseOverrides] = useState(() => new Map<string, boolean>())
  function setFileCollapsed(fileId: string, collapsed: boolean, groupId = selectedId) {
    setCollapseOverrides((previous) => new Map(previous).set(`${groupId}/${fileId}`, collapsed))
  }
  return { collapseOverrides, setFileCollapsed }
}

function sectionReviewActions(options: {
  pull: PullRequest
  draft: ReviewDraft
  setDraft: Dispatch<SetStateAction<ReviewDraft>>
  groups: ChangeGroup[]
  selected?: ChangeGroup
  visibleGroup?: ChangeGroup
  itemSections?: Map<string, string[]>
  changeView: (changes: Partial<ReviewView>) => void
  setFileCollapsed: (fileId: string, collapsed: boolean) => void
}) {
  const { pull, draft, setDraft, groups, selected, visibleGroup, changeView } = options
  const viewed = reviewedHunkIds(pull, draft)
  function itemSectionIds(itemId: string) {
    return options.itemSections?.get(itemId) ?? []
  }
  /** Moving on after the last section keeps a reviewer in flow across groups. */
  function advanceIfComplete(nextDraft: ReviewDraft) {
    if (!selected || !groupIsViewed(selected, nextDraft, pull)) return false
    const next = nextUnreviewedGroup(groups, selected.id, nextDraft, pull)
    if (next) changeView({ groupId: next.id })
    return Boolean(next)
  }
  function toggleSections(ids: string[]) {
    const visible = ids.filter((id) => visibleGroup?.hunkIds.includes(id))
    if (!visible.length) return
    setDraft((previous) => toggleViewedSections(pull, previous, visible))
  }
  /** Marks one section viewed; returns whether the review moved to another group. */
  function markSectionViewed(id: string) {
    if (!visibleGroup?.hunkIds.includes(id) || viewed.has(id)) return false
    const nextDraft = toggleViewedSections(pull, draft, [id])
    setDraft(nextDraft)
    return advanceIfComplete(nextDraft)
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
  return { toggleSections, toggleFile, fileSectionsViewed, markSectionViewed }
}

function groupProgress(
  pull: PullRequest,
  draft: ReviewDraft,
  viewedHunks: Set<string>,
  { groupId, updates }: { groupId?: string; updates?: ChangeGroup },
) {
  const groups =
    pull.groupingSource !== 'files' ? [...(updates ? [updates] : []), ...pull.groups] : []
  const selected =
    groups.find((group) => group.id === groupId) ??
    groups.find((group) => !groupIsViewed(group, draft, pull)) ??
    groups[0]
  const selectedHunks = pull.files
    .flatMap((file) => file.hunks)
    .filter((hunk) => selected?.hunkIds.includes(hunk.id))
  const viewedCount = selectedHunks.filter((hunk) => viewedHunks.has(hunk.id)).length
  return { groups, selected, viewedHunks, selectedHunks, viewedCount }
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
