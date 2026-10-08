import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { SetURLSearchParams } from 'react-router'
import {
  DiffSide,
  type ChangeGroup,
  type ChangedFile,
  type PullRequest,
} from '../../../shared/domain/types'
import type { ReviewLocation } from '../../../shared/domain/review'
import { updateReviewView } from '../../lib/routes'
import { discussionGroup, type LineDiscussion } from './discussions/discussions'

interface FocusOptions {
  searchParams: URLSearchParams
  setSearchParams: SetURLSearchParams
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void
  showViewedSections: (fileId: string, shown: boolean, groupId?: string) => void
  selected?: ChangeGroup
  items: CodeViewItem<undefined>[]
  viewerRef: RefObject<Pick<
    CodeViewHandle<LineDiscussion, undefined>,
    'scrollTo' | 'setSelectedLines' | 'clearSelectedLines'
  > | null>
}

export function useReviewFocus(pull: PullRequest, options: FocusOptions) {
  const [location, setLocation] = useState<ReviewLocation>()
  const file = location && pull.files.find((file) => file.path === location.path)
  // The updates group repeats sections from regular groups; stay in it when it shows the line.
  const shown =
    location != null &&
    file != null &&
    options.items.some((item) => item.id === file.id) &&
    groupShowsLine(file, options.selected, location)
  const group = location && (shown ? options.selected : discussionGroup({ pull, ...location }))
  const reveal = useEffectEvent(() => {
    if (!file || !group) return
    options.setFileCollapsed(file.id, false, group.id)
    options.showViewedSections(file.id, true, group.id)
    const next = updateReviewView(options.searchParams, { groupId: group.id })
    if (next.toString() !== options.searchParams.toString()) options.setSearchParams(next)
  })
  useEffect(() => {
    if (location) reveal()
  }, [location, file, group])
  useEffect(() => {
    const viewer = options.viewerRef.current
    if (!location) {
      viewer?.clearSelectedLines()
      return
    }
    if (!file || group?.id !== options.selected?.id) return
    const item = options.items.find((item) => item.id === file.id)
    if (!item || item.collapsed) return
    const side = location.side === DiffSide.left ? 'deletions' : 'additions'
    viewer?.setSelectedLines({
      id: file.id,
      range: { start: location.line, end: location.line, side },
    })
    viewer?.scrollTo({
      type: 'line',
      id: file.id,
      lineNumber: location.line,
      side,
      align: 'center',
    })
    return () => viewer?.clearSelectedLines()
  }, [location, file, group, options.selected?.id, options.items, options.viewerRef])
  return { focusLine: setLocation, location, active: Boolean(location) }
}

function groupShowsLine(
  file: ChangedFile,
  group: ChangeGroup | undefined,
  location: ReviewLocation,
) {
  return file.hunks.some(
    (hunk) =>
      group?.hunkIds.includes(hunk.id) &&
      hunk.lines.some(
        (line) => (location.side === DiffSide.left ? line.oldLine : line.newLine) === location.line,
      ),
  )
}
