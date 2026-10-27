import { useEffect, useState } from 'react'
import { ArrowLeftRight, Copy } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { DiffSide, TransferKind, type PullRequest } from '../../../shared/domain/types'
import type { PullFileContent } from '../../../shared/domain/fileContent'
import { lineRange, transferFile, transferView, type TransferView } from './transferContext'
import type { LinePlace, TransferNote } from './transferNotes'
import { TransferChanges } from './TransferChanges'
import './transfers.css'

interface Props {
  pull: PullRequest
  note: TransferNote
  contents: ReadonlyMap<string, PullFileContent>
  load: (fileId: string) => Promise<PullFileContent>
  onJump: (place: LinePlace) => void
}

/**
 * One end of a moved or copied block, under its last displayed line: where the other end is,
 * the function around it, how much changed on the way, and the changes themselves on demand.
 */
export function TransferCard({ pull, note, contents, load, onJump }: Props) {
  const { transfer, counterpart } = note
  const [open, setOpen] = useState(false)
  useTransferContents(pull, note, load)
  const view = transferView(pull, transfer, contents)
  const other = otherEnd(note, view)
  const Icon = transfer.kind === TransferKind.moved ? ArrowLeftRight : Copy
  return (
    <section className="transfer-card" aria-label={`${other.label} ${other.location}`}>
      <div className="transfer-card-header">
        <Icon size={13} className="transfer-card-icon" aria-hidden="true" />
        <span className="transfer-card-label">{other.label}</span>
        <code>{other.location}</code>
        {other.symbol && (
          <>
            <span className="muted">{other.connector}</span>
            <code>{other.symbol}</code>
          </>
        )}
        {view.changedSymbol && (
          <Badge
            variant="warning"
            className="text-warning"
            title="Check that the code still holds where it landed: its surrounding function changed."
          >
            changed function
          </Badge>
        )}
        <Badge variant="secondary">
          {transfer.exact
            ? 'identical'
            : `${String(transfer.changedLines)} of ${String(transfer.lineCount)} lines changed`}
        </Badge>
        <span className="transfer-card-spacer" />
        {counterpart && (
          <Button
            variant="ghost-muted"
            size="micro"
            onClick={() => {
              onJump(counterpart)
            }}
          >
            Jump {counterpart.below ? '↓' : '↑'}
          </Button>
        )}
        {!transfer.exact && (
          <Button
            variant="outline"
            size="micro"
            aria-expanded={open}
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            {open ? 'Hide changes ▾' : 'Show changes ▸'}
          </Button>
        )}
      </div>
      {open && <TransferChanges transfer={transfer} />}
    </section>
  )
}

/** Both ends' revisions name the functions around the block; fetch them once a card shows. */
function useTransferContents(
  pull: PullRequest,
  note: TransferNote,
  load: (fileId: string) => Promise<PullFileContent>,
) {
  const { transfer } = note
  useEffect(() => {
    for (const side of [DiffSide.left, DiffSide.right]) {
      const file = transferFile(pull, transfer, side)
      if (file) void load(file.id).catch(() => {})
    }
  }, [pull, transfer, load])
}

const labels = {
  [TransferKind.moved]: {
    source: { label: 'Moved to', connector: 'into' },
    destination: { label: 'Moved from', connector: 'was in' },
  },
  [TransferKind.copied]: {
    source: { label: 'Copied to', connector: 'in' },
    destination: { label: 'Copied from', connector: 'in' },
  },
}

/** The end of the block a card points at: the destination from the source and vice versa. */
function otherEnd({ transfer, end }: TransferNote, view: TransferView) {
  const toSource = end === 'destination'
  const [path, first, last] = toSource
    ? [transfer.fromPath, transfer.fromLine, transfer.fromEndLine]
    : [transfer.toPath, transfer.toLine, transfer.toEndLine]
  return {
    ...labels[transfer.kind][end],
    location: `${path}:${lineRange(first, last)}`,
    symbol: toSource ? view.fromSymbol : view.toSymbol,
  }
}

/** The file header's count of moved and copied blocks with an end in this file. */
export function TransferChip({ moved, copied }: { moved: number; copied: number }) {
  if (!moved && !copied) return null
  const parts = [
    ...(moved ? [`⇄ ${String(moved)} moved`] : []),
    ...(copied ? [`⧉ ${String(copied)} copied`] : []),
  ]
  return (
    <span className="transfer-chip" title="Blocks of this file that were moved or copied">
      {parts.join(' · ')}
    </span>
  )
}
