import { DiffSide, type TransferKind } from '../../../../shared/domain/types'

/**
 * Tint the rows of moved and copied code in place, so they read as relocated rather than as new
 * or deleted code. Marks both the code row and its line number. Pierre re-renders rows on
 * scroll, so this runs after every render and is idempotent.
 */
export function markTransferRows(
  root: ShadowRoot,
  rows: ReadonlyMap<string, TransferKind> | undefined,
) {
  for (const row of root.querySelectorAll<HTMLElement>('[data-line-type]')) {
    const kind = rows && rowTransfer(row, rows)
    if (!kind) row.removeAttribute('data-transfer')
    else if (row.dataset.transfer !== kind) row.dataset.transfer = kind
  }
}

function rowTransfer(row: HTMLElement, rows: ReadonlyMap<string, TransferKind>) {
  const type = row.getAttribute('data-line-type')
  const side =
    type === 'change-deletion'
      ? DiffSide.left
      : type === 'change-addition'
        ? DiffSide.right
        : undefined
  const line = row.getAttribute('data-line') ?? row.getAttribute('data-column-number')
  return side && line ? rows.get(`${side}:${line}`) : undefined
}
