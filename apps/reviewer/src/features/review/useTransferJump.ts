import { useEffect, useRef, type RefObject } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { DiffSide, type ChangeGroup } from '../../../shared/domain/types'
import type { ReviewView } from '../../lib/routes'
import { availableLines } from './discussions/discussions'
import type { LinePlace } from './transferNotes'

interface JumpOptions {
  selected?: ChangeGroup
  items: readonly CodeViewItem<undefined>[]
  changeView: (changes: Partial<ReviewView>) => void
  revealFile: (fileId: string, groupId?: string, line?: Omit<LinePlace, 'fileId'>) => void
  viewerRef: RefObject<Pick<CodeViewHandle<never, undefined>, 'scrollTo'> | null>
}

/** Reveal a line, then scroll once the viewer shows it. */
export function useTransferJump(options: JumpOptions) {
  const { selected, items, changeView, revealFile, viewerRef } = options
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
    if (!items.some((item) => item.id === place.fileId && !item.collapsed)) return
    pending.current = undefined
    scrollTo(place)
  })
  return (target: LinePlace & { groupId?: string }) => {
    const groupId = target.groupId ?? selected?.id
    pending.current = undefined
    revealFile(target.fileId, groupId, target)
    if (groupId && groupId !== selected?.id) {
      pending.current = { ...target, groupId }
      changeView({ groupId })
    } else if (selected?.claim && !lineIsDisplayed(items, target)) {
      pending.current = { ...target, groupId: selected.id }
    } else {
      scrollTo(target)
    }
  }
}

function lineIsDisplayed(items: JumpOptions['items'], target: LinePlace) {
  const item = items.find((item) => item.id === target.fileId)
  return (
    item?.type === 'diff' &&
    !item.collapsed &&
    availableLines(item.fileDiff.hunks).has(`${target.side}:${target.line}`)
  )
}
