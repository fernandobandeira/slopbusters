import { useEffect, useRef, type RefObject } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { DiffSide, type ChangeGroup } from '../../../shared/domain/types'
import type { ReviewView } from '../../lib/routes'
import type { Counterpart, LinePlace } from './transferNotes'

interface JumpOptions {
  selected?: ChangeGroup
  items: readonly Pick<CodeViewItem<undefined>, 'id'>[]
  changeView: (changes: Partial<ReviewView>) => void
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void
  viewerRef: RefObject<Pick<CodeViewHandle<never, undefined>, 'scrollTo'> | null>
}

/**
 * Jump from one end of a moved or copied block to the other. An end in another group opens that
 * group first and scrolls once its viewer shows the file.
 */
export function useTransferJump(options: JumpOptions) {
  const { selected, items, changeView, setFileCollapsed, viewerRef } = options
  const pending = useRef<LinePlace & { groupId: string }>(undefined)
  const scrollTo = (place: LinePlace) => {
    viewerRef.current?.scrollTo({
      type: 'line',
      id: place.fileId,
      lineNumber: place.line,
      side: place.side === DiffSide.left ? 'deletions' : 'additions',
      align: 'center',
    })
  }
  useEffect(() => {
    const place = pending.current
    if (!place || place.groupId !== selected?.id) return
    if (!items.some((item) => item.id === place.fileId)) return
    pending.current = undefined
    scrollTo(place)
  })
  return (target: Counterpart) => {
    if ('groupId' in target && target.groupId !== selected?.id) {
      pending.current = target
      setFileCollapsed(target.fileId, false, target.groupId)
      changeView({ groupId: target.groupId })
      return
    }
    setFileCollapsed(target.fileId, false, selected?.id)
    scrollTo(target)
  }
}
