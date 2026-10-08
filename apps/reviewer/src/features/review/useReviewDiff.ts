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
import { diffItems } from './diff/diffItems'
import { displayPullWithContext } from './diff/displayContext'

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
  const view = readReviewView(searchParams)
  const progress = groupProgress(pull, draft, view.groupId)
  const { selected, viewedHunks } = progress
  const filters = useVisibleGroup({ selected, viewedHunks, searchParams, changes })
  const { visibleGroup, changesOnly } = filters
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
  const items = useCollapsedItems({
    pull,
    displayPull,
    visibleGroup,
    selected,
    contents: fileContext.contents,
    viewedHunkIds: changesOnly ? [] : [...viewedHunks],
    collapseOverrides,
  })
  const actions = sectionReviewActions({
    pull,
    draft,
    setDraft,
    selected,
    visibleGroup,
    changeView,
    setFileCollapsed,
    changes: changesOnly ? changes : undefined,
  })
  return {
    ...progress,
    ...filters,
    ...actions,
    grouped: pull.groupingSource !== 'files',
    split: view.split,
    searchParams,
    setSearchParams,
    changeView,
    fileContext,
    contextLines,
    setContextLines,
    items,
    setFileCollapsed,
  }
}

function useVisibleGroup(options: {
  selected?: ChangeGroup
  viewedHunks: Set<string>
  searchParams: URLSearchParams
  changes?: ReviewChanges
}) {
  const { selected, viewedHunks, searchParams, changes } = options
  const unviewedOnly = searchParams.get('unviewed') === '1'
  const changesOnly = searchParams.get('changes') === '1'
  const visibleGroup = useMemo(() => {
    const updated = new Set(changes?.sections.map((section) => section.hunkId))
    return (
      selected && {
        ...selected,
        hunkIds: selected.hunkIds.filter(
          (id) => (!unviewedOnly || !viewedHunks.has(id)) && (!changesOnly || updated.has(id)),
        ),
      }
    )
  }, [selected, unviewedOnly, changesOnly, viewedHunks, changes])
  return { visibleGroup, unviewedOnly, changesOnly }
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
  selected?: ChangeGroup
  visibleGroup?: ChangeGroup
  changeView: (changes: Partial<ReviewView>) => void
  setFileCollapsed: (fileId: string, collapsed: boolean) => void
  changes?: ReviewChanges
}) {
  const { pull, draft, setDraft, selected, visibleGroup, changeView, setFileCollapsed } = options
  const viewed = reviewedHunkIds(pull, draft)
  const eligibleGroups = updatedReviewGroups(pull.groups, options.changes)
  function visibleSectionIds(fileId: string) {
    return (
      pull.files
        .find((file) => file.id === fileId)
        ?.hunks.filter((hunk) => visibleGroup?.hunkIds.includes(hunk.id))
        .map((hunk) => hunk.id) ?? []
    )
  }
  function toggleSections(ids: string[]) {
    const visible = ids.filter((id) => visibleGroup?.hunkIds.includes(id))
    if (!visible.length) return
    setDraft((previous) => toggleViewedSections(pull, previous, visible))
  }
  function toggleFile(fileId: string) {
    if (!selected) return
    const ids = visibleSectionIds(fileId)
    if (!ids.length) return
    const nextDraft = toggleViewedSections(pull, draft, ids)
    const markingViewed = ids.every((id) => nextDraft.viewedHunkIds?.includes(id))
    setFileCollapsed(fileId, markingViewed)
    setDraft(nextDraft)
    const completionGroup = eligibleGroups.find((group) => group.id === selected.id)
    if (markingViewed && completionGroup && groupIsViewed(completionGroup, nextDraft, pull)) {
      const next = nextUnreviewedGroup(eligibleGroups, selected.id, nextDraft, pull)
      if (next) changeView({ groupId: next.id })
    }
  }
  function fileSectionsViewed(fileId: string) {
    const ids = visibleSectionIds(fileId)
    return ids.length > 0 && ids.every((id) => viewed.has(id))
  }
  return { toggleSections, toggleFile, fileSectionsViewed }
}

function updatedReviewGroups(groups: ChangeGroup[], changes?: ReviewChanges): ChangeGroup[] {
  if (!changes) return groups
  const ids = new Set(changes.sections.map((section) => section.hunkId))
  return groups
    .map((group) => ({ ...group, hunkIds: group.hunkIds.filter((id) => ids.has(id)) }))
    .filter((group) => group.hunkIds.length > 0)
}

function groupProgress(pull: PullRequest, draft: ReviewDraft, groupId?: string) {
  const groups = pull.groupingSource !== 'files' ? pull.groups : []
  const selected =
    groups.find((group) => group.id === groupId) ??
    groups.find((group) => !groupIsViewed(group, draft, pull)) ??
    groups[0]
  const viewedHunks = reviewedHunkIds(pull, draft)
  const selectedHunks = pull.files
    .flatMap((file) => file.hunks)
    .filter((hunk) => selected?.hunkIds.includes(hunk.id))
  const viewedCount = selectedHunks.filter((hunk) => viewedHunks.has(hunk.id)).length
  return { groups, selected, viewedHunks, selectedHunks, viewedCount }
}

function collapsedDiffItems(options: {
  pull: PullRequest
  displayPull: PullRequest
  visibleGroup: ChangeGroup
  selected?: ChangeGroup
  contents: ReturnType<typeof useFileContext>['contents']
  viewedHunkIds: string[]
  collapseOverrides: Map<string, boolean>
}) {
  const { pull, displayPull, visibleGroup, selected, contents, viewedHunkIds, collapseOverrides } =
    options
  return diffItems(displayPull, visibleGroup, contents).map((item) => {
    const ids =
      pull.files
        .find((file) => file.id === item.id)
        ?.hunks.filter((hunk) => visibleGroup.hunkIds.includes(hunk.id))
        .map((hunk) => hunk.id) ?? []
    const viewed = ids.length > 0 && ids.every((id) => viewedHunkIds.includes(id))
    return { ...item, collapsed: collapseOverrides.get(`${selected?.id}/${item.id}`) ?? viewed }
  })
}

function useCollapsedItems(
  options: Omit<Parameters<typeof collapsedDiffItems>[0], 'visibleGroup'> & {
    visibleGroup?: ChangeGroup
  },
) {
  const { pull, displayPull, visibleGroup, selected, contents, viewedHunkIds, collapseOverrides } =
    options
  return useMemo(
    () =>
      visibleGroup
        ? collapsedDiffItems({
            pull,
            displayPull,
            visibleGroup,
            selected,
            contents: contents,
            viewedHunkIds: viewedHunkIds,
            collapseOverrides,
          })
        : [],
    [pull, displayPull, visibleGroup, selected, contents, viewedHunkIds, collapseOverrides],
  )
}
