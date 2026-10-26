import type { NavigationTarget } from '../../../shared/domain/navigation'

export const destinationStyles = `
[data-line][data-source-destination] {
  background: color-mix(in srgb, var(--primary) 16%, transparent);
  box-shadow: inset 3px 0 var(--primary);
  animation: source-destination-arrival 900ms ease-out;
}
[data-source-destination-token] {
  background: color-mix(in srgb, var(--primary) 26%, transparent);
  outline: 1px solid color-mix(in srgb, var(--primary) 55%, transparent);
  border-radius: 3px;
  font-weight: 700;
}
@keyframes source-destination-arrival {
  from { background: color-mix(in srgb, var(--primary) 36%, transparent); }
  to { background: color-mix(in srgb, var(--primary) 16%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  [data-line][data-source-destination] { animation: none; }
}
`

export function highlightDestination(
  root: ShadowRoot,
  target?: NavigationTarget,
  side: 'old' | 'new' = 'new',
) {
  for (const row of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = rowLine(row, side)
    const focused = Boolean(target && line && line >= target.line && line <= target.endLine)
    row.toggleAttribute('data-source-destination', focused)
    for (const token of row.querySelectorAll<HTMLElement>('[data-char]')) {
      const start = Number(token.dataset.char)
      const end = start + token.textContent.length
      token.toggleAttribute(
        'data-source-destination-token',
        Boolean(
          focused &&
          target &&
          (line !== target.line || end > target.column - 1) &&
          (line !== target.endLine || start < target.endColumn - 1),
        ),
      )
    }
  }
}

/**
 * A row's line number on one side of the source. Plain files have one numbering; in a diff,
 * deletions and the split deletions column count old lines, and context rows carry the old
 * number as their alternate.
 */
function rowLine(row: HTMLElement, side: 'old' | 'new') {
  const type = row.dataset.lineType
  if (!type) return Number(row.dataset.line)
  const column = row.closest('[data-code]')
  const old = column?.hasAttribute('data-deletions')
    ? true
    : column?.hasAttribute('data-additions')
      ? false
      : type.includes('deletion')
  if (type === 'context' && !column?.hasAttribute('data-deletions'))
    return Number(side === 'old' ? row.dataset.altLine : row.dataset.line)
  return old === (side === 'old') ? Number(row.dataset.line) : undefined
}
