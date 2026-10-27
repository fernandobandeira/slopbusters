import {
  LineKind,
  TransferKind,
  type CodeTransfer,
  type DiffLine,
  type Hunk,
  type PullRequest,
} from '../../shared/domain/types'

/** A hunk line as a model pass reads it, or a marker standing for lines of a moved or copied block. */
export interface PromptLine {
  kind: LineKind | TransferKind
  text: string
  oldLine: number | null
  newLine: number | null
  /** On a marker, the last line it stands for, on the side its oldLine or newLine names. */
  endLine?: number
}

/** What a model pass is told about the markers; empty when the PR moved and copied nothing. */
export function transferInstructions(pull: Pick<PullRequest, 'transfers'>): string {
  if (!pull.transfers.length) return ''
  return "\n\nThe PR moves or copies blocks of code, listed under transfers. In a hunk, a line of kind moved or copied is a marker that stands for that hunk's changed lines from its oldLine or newLine through endLine. A block moved or copied unchanged, ignoring indentation, is replaced by its marker: review where it now sits and how it is called, not its text again. An edited block keeps its lines after the marker, and the transfer's editsInsideBlock are the only lines that differ from its source; focus there. The removed source of a moved block is a marker too. Lines a marker stands for are real changed lines: anchor a finding to one with the hunk's id and any line number in the marker's range."
}

/** The PR's transfers as a model pass reads them, with the edits made inside each edited block. */
export function transferEvidence(pull: Pick<PullRequest, 'transfers'>) {
  return pull.transfers.map((transfer) => ({
    kind: transfer.kind,
    from: sourceRange(transfer),
    to: destinationRange(transfer),
    lines: transfer.lineCount,
    exact: transfer.exact,
    ...(transfer.exact
      ? {}
      : {
          changedLines: transfer.changedLines,
          editsInsideBlock: transfer.changes.map(({ header, lines }) => ({
            header,
            lines: lines.map(({ kind, text, oldLine, newLine }) => ({
              kind,
              text,
              oldLine,
              newLine,
            })),
          })),
        }),
  }))
}

/**
 * Renders hunks for a model pass. The lines of a block moved or copied unchanged collapse into one
 * marker, as does the removed source of a move; an edited block keeps its lines behind a marker.
 */
export function transferLines(pull: Pick<PullRequest, 'transfers'>): (hunk: Hunk) => PromptLine[] {
  const owners = new Map<string, { transfer: CodeTransfer; side: 'source' | 'destination' }>()
  for (const transfer of pull.transfers) {
    for (const id of transfer.sourceLineIds) owners.set(id, { transfer, side: 'source' })
    for (const id of transfer.destinationLineIds) owners.set(id, { transfer, side: 'destination' })
  }
  return (hunk) => {
    const rendered: PromptLine[] = []
    let current: { owner: string; marker: PromptLine } | undefined
    for (const line of hunk.lines) {
      const owner = owners.get(line.id)
      const number = owner?.side === 'source' ? line.oldLine : line.newLine
      if (!owner || number == null) {
        current = undefined
        rendered.push(promptLine(line))
        continue
      }
      const key = `${owner.transfer.id}:${owner.side}`
      if (current?.owner !== key) {
        current = { owner: key, marker: marker(owner.transfer, owner.side, number) }
        rendered.push(current.marker)
      }
      current.marker.endLine = number
      const collapsed = owner.side === 'source' || owner.transfer.exact
      if (!collapsed) rendered.push(promptLine(line))
    }
    return rendered
  }
}

function promptLine({ kind, text, oldLine, newLine }: DiffLine): PromptLine {
  return { kind, text, oldLine, newLine }
}

function marker(transfer: CodeTransfer, side: 'source' | 'destination', line: number): PromptLine {
  const verb = transfer.kind === TransferKind.moved ? 'moved' : 'copied'
  const lines = `${String(transfer.lineCount)} lines`
  let text: string
  if (side === 'source')
    text = `[${verb} to ${destinationRange(transfer)}${transfer.exact ? '' : ', edited'}]`
  else if (transfer.exact)
    text = `[${verb} unchanged from ${sourceRange(transfer)}; ${lines} — review its new context, not its text]`
  else
    text = `[${verb} from ${sourceRange(transfer)} with ${String(transfer.changedLines)} edited of ${lines}; the edits are under transfers]`
  return {
    kind: transfer.kind,
    text,
    oldLine: side === 'source' ? line : null,
    newLine: side === 'destination' ? line : null,
    endLine: line,
  }
}

function sourceRange(transfer: CodeTransfer): string {
  return `${transfer.fromPath}:${String(transfer.fromLine)}–${String(transfer.fromEndLine)}`
}

function destinationRange(transfer: CodeTransfer): string {
  return `${transfer.toPath}:${String(transfer.toLine)}–${String(transfer.toEndLine)}`
}
