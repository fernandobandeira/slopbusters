import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import {
  DiffSide,
  LineKind,
  TransferKind,
  type CodeTransfer,
  type DiffLine,
  type PullRequest,
} from '../../../shared/domain/types'
import {
  availableLines,
  controlledItemVersion,
  type LineDiscussion,
} from './discussions/discussions'
import { transferFile } from './transferContext'

/** A line of the displayed diff, on its original (left) or updated (right) side. */
export interface LinePlace {
  fileId: string
  side: DiffSide
  line: number
}
/** One end of a moved or copied block, annotated under the last line the diff shows of it. */
export interface TransferNote {
  kind: 'transfer'
  transfer: CodeTransfer
  /** The source sits in the base (left); the destination in the head (right). */
  end: 'source' | 'destination'
  /** The other end's annotated line, here or in the group that shows it, if any does. */
  counterpart?: Counterpart
}
/** Where a card jumps: below or above it in this view, or into another group. */
export type Counterpart = LinePlace & ({ below: boolean } | { groupId: string })
/** Everything annotated under a diff line. Several notes can share one line and side. */
export type LineNote = LineDiscussion | TransferNote

/** `side:line` keys of a file's transferred rows, by file id. */
export type TransferRows = ReadonlyMap<string, ReadonlyMap<string, TransferKind>>

/**
 * Add a card under each displayed end of every moved or copied block. An end the displayed
 * patch does not show gets no card; its counterpart jumps to the group that shows it, if any.
 */
export function annotateTransfers(
  items: CodeViewItem<LineNote>[],
  pull: PullRequest,
): CodeViewItem<LineNote>[] {
  const shown = shownLines(items, pull)
  const notes = new Map<string, DiffLineAnnotation<LineNote>[]>()
  for (const transfer of pull.transfers) {
    const source = endPlace(shown, pull, transfer, DiffSide.left)
    const destination = endPlace(shown, pull, transfer, DiffSide.right)
    const add = (place: Shown | undefined, other: Shown | undefined, end: TransferNote['end']) => {
      if (!place) return
      const elsewhere = other ? undefined : groupPlace(pull, transfer, otherSide(place.side))
      const list = notes.get(place.fileId) ?? []
      notes.set(place.fileId, list)
      list.push({
        lineNumber: place.line,
        side: place.side === DiffSide.left ? 'deletions' : 'additions',
        metadata: {
          kind: 'transfer',
          transfer,
          end,
          ...(other ? { counterpart: nearby(place, other) } : {}),
          ...(elsewhere ? { counterpart: elsewhere } : {}),
        },
      })
    }
    add(source, destination, 'source')
    add(destination, source, 'destination')
  }
  return items.map((item) => {
    const added = notes.get(item.id)
    if (!added || item.type !== 'diff') return item
    const next = { ...item, annotations: [...added, ...(item.annotations ?? [])] }
    return { ...next, version: controlledItemVersion<LineNote>(next) }
  })
}

/**
 * The rows to tint as transferred, from the removed and added patch lines each block owns.
 * Lines edited inside a block keep their normal change styling.
 */
export function transferRows(pull: PullRequest): TransferRows {
  const lines = new Map<string, { fileId: string; line: DiffLine }>()
  for (const file of pull.files)
    for (const hunk of file.hunks)
      for (const line of hunk.lines) lines.set(line.id, { fileId: file.id, line })
  const rows = new Map<string, Map<string, TransferKind>>()
  for (const transfer of pull.transfers) {
    const edited = editedRows(transfer)
    for (const id of [...transfer.sourceLineIds, ...transfer.destinationLineIds]) {
      const found = lines.get(id)
      const key = found && rowKey(found.line)
      if (!found || !key || edited.has(key)) continue
      const file = rows.get(found.fileId) ?? new Map<string, TransferKind>()
      rows.set(found.fileId, file.set(key, transfer.kind))
    }
  }
  return rows
}

/** Distinct blocks with an end annotated in an item, by kind, for its file header. */
export function transferCounts(annotations: readonly { metadata: LineNote }[] = []) {
  const ids = (kind: TransferKind) =>
    new Set(
      annotations.flatMap(({ metadata }) =>
        metadata.kind === 'transfer' && metadata.transfer.kind === kind
          ? [metadata.transfer.id]
          : [],
      ),
    ).size
  return { moved: ids(TransferKind.moved), copied: ids(TransferKind.copied) }
}

type Shown = LinePlace & { index: number }
type ShownLines = Map<string, { index: number; lines: Set<string> }>

function shownLines(items: CodeViewItem<LineNote>[], pull: PullRequest): ShownLines {
  const shown: ShownLines = new Map()
  items.forEach((item, index) => {
    // Display-only items, such as edits since a review, are not PR files and carry no cards.
    if (item.type !== 'diff' || !pull.files.some((file) => file.id === item.id)) return
    shown.set(item.id, { index, lines: availableLines(item.fileDiff.hunks) })
  })
  return shown
}

/** The last line of one end of a block that the displayed patch shows. */
function endPlace(
  shown: ShownLines,
  pull: PullRequest,
  transfer: CodeTransfer,
  side: DiffSide,
): Shown | undefined {
  const file = transferFile(pull, transfer, side)
  const item = file && shown.get(file.id)
  if (!file || !item) return undefined
  const [first, last] = endRange(transfer, side)
  for (let line = last; line >= first; line--)
    if (item.lines.has(`${side}:${String(line)}`))
      return { fileId: file.id, side, line, index: item.index }
  return undefined
}

function nearby(place: Shown, other: Shown): Counterpart {
  const below =
    other.index > place.index || (other.index === place.index && other.line > place.line)
  return { fileId: other.fileId, side: other.side, line: other.line, below }
}

/** The last line of one end that some group's sections show, for a jump into that group. */
function groupPlace(pull: PullRequest, transfer: CodeTransfer, side: DiffSide) {
  const file = transferFile(pull, transfer, side)
  if (!file) return undefined
  const [first, last] = endRange(transfer, side)
  for (const group of pull.groups) {
    const lines = file.hunks
      .filter((hunk) => group.hunkIds.includes(hunk.id))
      .flatMap((hunk) => hunk.lines)
      .flatMap((line) => (side === DiffSide.left ? line.oldLine : line.newLine) ?? [])
      .filter((line) => line >= first && line <= last)
    if (lines.length) return { fileId: file.id, side, line: Math.max(...lines), groupId: group.id }
  }
  return undefined
}

function endRange(transfer: CodeTransfer, side: DiffSide): [number, number] {
  return side === DiffSide.left
    ? [transfer.fromLine, transfer.fromEndLine]
    : [transfer.toLine, transfer.toEndLine]
}

function otherSide(side: DiffSide) {
  return side === DiffSide.left ? DiffSide.right : DiffSide.left
}

function rowKey(line: Pick<DiffLine, 'kind' | 'oldLine' | 'newLine'>) {
  if (line.kind === LineKind.removed && line.oldLine != null)
    return `${DiffSide.left}:${String(line.oldLine)}`
  if (line.kind === LineKind.added && line.newLine != null)
    return `${DiffSide.right}:${String(line.newLine)}`
  return undefined
}

function editedRows(transfer: CodeTransfer) {
  return new Set(
    transfer.changes.flatMap((change) => change.lines.map(rowKey)).filter((key) => key != null),
  )
}
