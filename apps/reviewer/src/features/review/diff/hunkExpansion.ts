import type { ExpansionDirections, HunkExpansionRegion } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'

/** The private Pierre 1.5 members this module relies on; checked at runtime before use. */
interface ExpandableInstance {
  hunksRenderer?: { setExpandedHunksMap?: (map: Map<number, HunkExpansionRegion>) => void }
  expandHunk?: (hunkIndex: number, direction: ExpansionDirections, lines?: number) => void
}

/** Whether a click inside a diff landed on one of Pierre's "N unmodified lines" expanders. */
export function isExpansionClick(event: Event) {
  const target = event.composedPath()[0]
  return (
    target instanceof Element &&
    target.closest('[data-expand-button], [data-unmodified-lines]') !== null
  )
}

/**
 * Pierre expands unchanged lines in place but has no way to fold them back. Clear the item's
 * expansion map, then request a zero-line expansion so Pierre runs its own relayout.
 */
export function collapseExpandedLines<LAnnotation>(
  viewer: CodeViewHandle<LAnnotation, undefined> | null,
  itemId: string,
) {
  const view = viewer?.getInstance() as
    { idToItem?: Map<string, { instance?: ExpandableInstance }> } | undefined
  const instance = view?.idToItem?.get(itemId)?.instance
  if (!instance?.hunksRenderer?.setExpandedHunksMap || !instance.expandHunk) return false
  instance.hunksRenderer.setExpandedHunksMap(new Map())
  instance.expandHunk(0, 'up', 0)
  return true
}
