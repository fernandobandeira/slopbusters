import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { DiffSide } from '../../../shared/domain/types'
import type { SectionTarget } from './reviewUpdates'
import type { LineDiscussion } from './discussions/discussions'

export const MARK_SECTION_KEY = 'v'

interface CursorOptions {
  targets: SectionTarget[]
  viewed: ReadonlySet<string>
  items: CodeViewItem<undefined>[]
  markSectionViewed: (id: string) => boolean
  setFileCollapsed: (itemId: string, collapsed: boolean) => void
  viewerRef: RefObject<Pick<CodeViewHandle<LineDiscussion, undefined>, 'scrollTo'> | null>
  enabled: boolean
}

/** The section a reviewer is reading. Pressing V marks it viewed and moves to the next unviewed
 * section in display order; without a current section it starts at the first unviewed one. */
export function useSectionCursor(options: CursorOptions) {
  const [current, setCurrent] = useState<string>()
  function reveal(target: SectionTarget) {
    if (options.items.find((item) => item.id === target.itemId)?.collapsed)
      options.setFileCollapsed(target.itemId, false)
    options.viewerRef.current?.scrollTo({
      type: 'line',
      id: target.itemId,
      lineNumber: target.line,
      side: target.side === DiffSide.left ? 'deletions' : 'additions',
      align: 'center',
    })
  }
  function markCurrentViewed() {
    const { targets, viewed } = options
    const target =
      targets.find((target) => target.hunkId === current && !viewed.has(target.hunkId)) ??
      targets.find((target) => !viewed.has(target.hunkId))
    if (!target) return
    if (options.markSectionViewed(target.hunkId)) {
      setCurrent(undefined)
      return
    }
    const index = targets.indexOf(target)
    const next = [...targets.slice(index + 1), ...targets.slice(0, index)].find(
      (candidate) => candidate.hunkId !== target.hunkId && !viewed.has(candidate.hunkId),
    )
    setCurrent(next?.hunkId)
    if (next) reveal(next)
  }
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!options.enabled || event.defaultPrevented || event.repeat) return
    if (event.key.toLowerCase() !== MARK_SECTION_KEY) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (isEditable(event.composedPath()[0])) return
    event.preventDefault()
    markCurrentViewed()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  return { section: current, setSection: setCurrent, markCurrentViewed }
}

function isEditable(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit'].includes(target.type)
  return (
    target.isContentEditable ||
    ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') != null
  )
}
