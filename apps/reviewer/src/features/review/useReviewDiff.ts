import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router'
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
) {
  const [collapseOverrides, setCollapseOverrides] = useState(() => new Map<string, boolean>())
  const fileContext = useFileContext(pull.id)
  const loadFileContext = fileContext.load
  const [contextLines, setContextLines] = useState(() => new Map<string, number>())
  const [searchParams, setSearchParams] = useSearchParams()
  const unviewedOnly = searchParams.get('unviewed') === '1'
  const view = readReviewView(searchParams)
  const grouped = pull.groupingSource !== 'files'
  const { split } = view
  function changeView(changes: Partial<ReviewView>) {
    const next = updateReviewView(searchParams, changes)
    if (next.toString() !== searchParams.toString()) setSearchParams(next)
  }
  const { groups, selected, selectedHunks, viewedCount, sectionIds, fileSectionsViewed } =
    groupProgress(pull, draft, view.groupId)
  const visibleGroup = useMemo(
    () =>
      selected && {
        ...selected,
        hunkIds: unviewedOnly
          ? selected.hunkIds.filter((id) => !(draft.viewedHunkIds ?? []).includes(id))
          : selected.hunkIds,
      },
    [selected, unviewedOnly, draft.viewedHunkIds],
  )
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
    viewedHunkIds: draft.viewedHunkIds ?? [],
    collapseOverrides,
  })
  function toggleFile(fileId: string) {
    if (!selected) return
    const nextDraft = toggleViewedSections(pull, draft, sectionIds(fileId))
    const markingViewed = sectionIds(fileId).every((id) => nextDraft.viewedHunkIds?.includes(id))
    setFileCollapsed(fileId, markingViewed)
    setDraft(nextDraft)
    if (markingViewed && groupIsViewed(selected, nextDraft, pull)) {
      const next = nextUnreviewedGroup(pull.groups, selected.id, nextDraft, pull)
      if (next) changeView({ groupId: next.id })
    }
  }
  function setFileCollapsed(fileId: string, collapsed: boolean, groupId = selected?.id) {
    setCollapseOverrides((previous) => {
      const next = new Map(previous)
      next.set(`${groupId}/${fileId}`, collapsed)
      return next
    })
  }
  return {
    groups,
    grouped,
    split,
    unviewedOnly,
    searchParams,
    setSearchParams,
    changeView,
    selected,
    selectedHunks,
    viewedCount,
    fileContext,
    contextLines,
    setContextLines,
    items,
    setFileCollapsed,
    toggleFile,
    fileSectionsViewed,
  }
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
  function sectionIds(fileId: string) {
    return (
      pull.files
        .find((file) => file.id === fileId)
        ?.hunks.filter((hunk) => selected?.hunkIds.includes(hunk.id))
        .map((hunk) => hunk.id) ?? []
    )
  }
  function fileSectionsViewed(fileId: string) {
    const sections = sectionIds(fileId)
    return sections.length > 0 && sections.every((id) => viewedHunks.has(id))
  }
  return {
    groups,
    selected,
    viewedHunks,
    selectedHunks,
    viewedCount,
    sectionIds,
    fileSectionsViewed,
  }
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
        ?.hunks.filter((hunk) => selected?.hunkIds.includes(hunk.id))
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
