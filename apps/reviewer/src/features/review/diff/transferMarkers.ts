import { DiffSide, type TransferKind } from '../../../../shared/domain/types'

/** Shadow-root styles for the rows `markTransferRows` marks. */
export const TRANSFER_ROWS_CSS = `
/* Moved and copied rows keep their place but read as relocated, not as new or deleted code. */
:is([data-line], [data-column-number])[data-transfer] {
  background-color: color-mix(in srgb, var(--info) 7%, var(--code-background)) !important;
  color: color-mix(in srgb, var(--info) 70%, var(--code-foreground)) !important;
}

[data-line][data-transfer] > * {
  opacity: 0.62;
}

[data-line][data-transfer] [data-diff-span] {
  background-color: transparent !important;
}

/* Like Pierre's classic +/- indicators, every row leaves the marker a column of its own. */
[data-line],
[data-no-newline] {
  padding-inline-start: 2ch !important;
}

[data-line][data-transfer]::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0.2ch;
  width: 1.4ch;
  font-size: 0.85em;
  text-align: center;
  color: var(--info);
  user-select: none;
}

[data-line][data-transfer='moved']::before {
  content: '⇄';
}

[data-line][data-transfer='copied']::before {
  content: '⧉';
}

[data-indicators='bars'] [data-column-number][data-transfer]::before {
  background: color-mix(in srgb, var(--info) 60%, transparent) !important;
}
`

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
