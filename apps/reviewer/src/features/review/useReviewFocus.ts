import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { SetURLSearchParams } from 'react-router'
import { DiffSide, type ChangeGroup, type PullRequest } from '../../../shared/domain/types'
import type { ReviewLocation } from '../../../shared/domain/review'
import { updateReviewView } from '../../lib/routes'
import { discussionGroup, type LineDiscussion } from './discussions/discussions'

interface FocusOptions {
  searchParams: URLSearchParams
  setSearchParams: SetURLSearchParams
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void
  selected?: ChangeGroup
  items: CodeViewItem<undefined>[]
  viewerRef: RefObject<Pick<
    CodeViewHandle<LineDiscussion, undefined>,
    'scrollTo' | 'setSelectedLines' | 'clearSelectedLines'
  > | null>
}

export function useReviewFocus(pull: PullRequest, options: FocusOptions) {
  const [location, focusLine] = useState<ReviewLocation>()
  const file = location && pull.files.find((file) => file.path === location.path)
  const group = location && discussionGroup({ pull, ...location })
  const reveal = useEffectEvent(() => {
    if (!file || !group) return
    options.setFileCollapsed(file.id, false, group.id)
    const next = updateReviewView(options.searchParams, { groupId: group.id })
    next.delete('unviewed')
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
  return { focusLine, active: Boolean(location) }
}
