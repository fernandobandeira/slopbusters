import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router'
import type { PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { readReviewView, updateReviewView, type ReviewView } from '../../lib/routes'
import { useFileContext } from './diff/useFileContext'
import { groupIsViewed, nextUnreviewedGroup, reviewedHunkIds, toggleViewedSections } from './reviewProgress'
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
  const groups = grouped ? pull.groups : []
  const selected =
    groups.find((group) => group.id === view.groupId) ??
    groups.find((group) => !groupIsViewed(group, draft, pull)) ??
    groups[0]
  const viewedHunks = reviewedHunkIds(pull, draft)
  const selectedHunks = pull.files
    .flatMap((file) => file.hunks)
    .filter((hunk) => selected?.hunkIds.includes(hunk.id))
  const viewedCount = selectedHunks.filter((hunk) => viewedHunks.has(hunk.id)).length
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
  const displayPull = useMemo(
    () => displayPullWithContext(pull, fileContext.contents, contextLines),
    [pull, fileContext.contents, contextLines],
  )
  useEffect(() => {
    for (const fileId of visibleGroup?.fileIds ?? []) void loadFileContext(fileId).catch(() => {})
  }, [visibleGroup, loadFileContext])
  const items = useMemo(() => {
    return visibleGroup
      ? diffItems(displayPull, visibleGroup, fileContext.contents).map((item) => {
          const ids =
            pull.files
              .find((file) => file.id === item.id)
              ?.hunks.filter((hunk) => selected?.hunkIds.includes(hunk.id))
              .map((hunk) => hunk.id) ?? []
          const viewed =
            ids.length > 0 && ids.every((id) => (draft.viewedHunkIds ?? []).includes(id))
          return {
            ...item,
            collapsed: collapseOverrides.get(`${selected?.id}/${item.id}`) ?? viewed,
          }
        })
      : []
  }, [
    pull,
    displayPull,
    fileContext.contents,
    visibleGroup,
    selected,
    collapseOverrides,
    draft.viewedHunkIds,
  ])
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
