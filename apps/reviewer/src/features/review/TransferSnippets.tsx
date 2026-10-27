import { useMemo } from 'react'
import type { CodeViewItem } from '@pierre/diffs'
import { DIFF_LINE_HEIGHT } from '~/components/diffs/StyledDiffCodeView'
import { ReviewDiffCodeView } from '../../components/ReviewDiffCodeView'
import { patchItems } from '../../lib/diffItems'
import { useReviewerTheme } from '../../app/ThemeProvider'
import { LineKind, type CodeTransfer } from '../../../shared/domain/types'
import type { RevisionFileContent } from '../../../shared/domain/fileContent'
import { lineRange } from './transferContext'

/** Unchanged lines shown on each side of a copy's original. */
const ORIGINAL_CONTEXT = 3

/** The edits made inside a moved or copied block, as a small read-only diff. */
export function TransferChanges({ transfer }: { transfer: CodeTransfer }) {
  const items = useMemo(
    () =>
      patchItems({
        id: transfer.id,
        path: transfer.toPath,
        ...(transfer.fromPath === transfer.toPath ? {} : { previousPath: transfer.fromPath }),
        hunks: transfer.changes,
        cacheKey: `transfer:${transfer.id}`,
      }),
    [transfer],
  )
  return (
    <div className="transfer-card-changes">
      <p className="transfer-card-caption">
        What changed inside the {transfer.kind} block (old{' '}
        {lineRange(transfer.fromLine, transfer.fromEndLine)} → new{' '}
        {lineRange(transfer.toLine, transfer.toEndLine)}), indentation ignored
      </p>
      <SnippetView items={items} />
    </div>
  )
}

/**
 * The code a copy was taken from, with a few lines around it, when no section shows it. Pierre's
 * file items always number from 1, so the excerpt is an all-context hunk at its base line numbers.
 */
export function TransferOriginal({
  transfer,
  revision,
}: {
  transfer: CodeTransfer
  revision: RevisionFileContent | null | undefined
}) {
  const items = useMemo(
    () => (revision ? originalItems(transfer, revision) : []),
    [transfer, revision],
  )
  return (
    <div className="transfer-card-changes">
      <p className="transfer-card-caption">
        The original in {transfer.fromPath} at the base revision (lines{' '}
        {lineRange(transfer.fromLine, transfer.fromEndLine)})
      </p>
      {revision === undefined ? (
        <p className="transfer-card-caption">Loading the original…</p>
      ) : items.length ? (
        <SnippetView items={items} />
      ) : (
        <p className="transfer-card-caption">The original could not be read.</p>
      )}
    </div>
  )
}

function originalItems(transfer: CodeTransfer, revision: RevisionFileContent) {
  const source = revision.content.split('\n')
  const first = Math.max(1, transfer.fromLine - ORIGINAL_CONTEXT)
  const last = Math.min(source.length, transfer.fromEndLine + ORIGINAL_CONTEXT)
  if (last < first) return []
  const lines = source.slice(first - 1, last).map((text, index) => ({
    kind: LineKind.context,
    text: text.replace(/\r$/, ''),
    oldLine: first + index,
    newLine: first + index,
  }))
  const count = String(lines.length)
  return patchItems({
    id: `${transfer.id}:original`,
    path: transfer.fromPath,
    hunks: [{ header: `@@ -${String(first)},${count} +${String(first)},${count} @@`, lines }],
    cacheKey: `transfer-original:${transfer.id}:${revision.sha}`,
  })
}

/** Hunk separators and the bottom padding inside the viewer, as StyledDiffCodeView measures. */
const SEPARATOR_HEIGHT = 24
const VIEW_PADDING = 8
const MAX_HEIGHT = 360

/** A small read-only diff sized to its rows: it virtualizes in its own box, which needs a height. */
function SnippetView({ items }: { items: CodeViewItem<undefined>[] }) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  const height = items.reduce(
    (total, item) =>
      total +
      (item.type === 'diff'
        ? item.fileDiff.unifiedLineCount * DIFF_LINE_HEIGHT +
          item.fileDiff.hunks.length * SEPARATOR_HEIGHT
        : 0),
    VIEW_PADDING,
  )
  return (
    <ReviewDiffCodeView
      className="transfer-card-diff"
      style={{ height: Math.min(height, MAX_HEIGHT) }}
      items={items}
      options={{
        theme: themeId,
        themeType: resolvedTheme,
        diffStyle: 'unified',
        overflow: 'scroll',
        disableFileHeader: true,
        // Unchanged lines around a snippet are counted, not expandable: there is no file to expand.
        hunkSeparators: 'line-info-basic',
      }}
    />
  )
}
