import type { ExpansionDirections, HunkExpansionRegion } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'

/** The private Pierre 1.5 members this module relies on; checked at runtime before use. */
interface ExpandableInstance {
  hunksRenderer?: { setExpandedHunksMap?: (map: Map<number, HunkExpansionRegion>) => void }
  expandHunk?: (hunkIndex: number, direction: ExpansionDirections, lines?: number) => void
}

/**
 * What a click on a "N unmodified lines" separator does: Pierre expands it when the file has full
 * revisions; otherwise the gap hides another group's edit and the file must reveal it first.
 */
export function separatorClick(event: Event): 'expand' | 'reveal' | undefined {
  const target = event.composedPath()[0]
  if (!(target instanceof Element)) return undefined
  if (!target.closest('[data-expand-button], [data-unmodified-lines]')) return undefined
  return target.closest('[data-separator]')?.querySelector('[data-expand-button]')
    ? 'expand'
    : 'reveal'
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
