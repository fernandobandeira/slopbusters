import { useEffect } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { TransferKind, type CodeTransfer, type PullRequest } from '../../../shared/domain/types'
import type { PullFileContent } from '../../../shared/domain/fileContent'
import { transferView, type TransferEnd } from './transferContext'

interface Props {
  pull: PullRequest
  transfers: CodeTransfer[]
  contents: ReadonlyMap<string, PullFileContent>
  load: (fileId: string) => Promise<PullFileContent>
}

/**
 * Code the PR moved or copied without changing it. Unchanged text is rarely what needs review, but
 * its new surroundings may be: each block shows the function and code around it at both ends, and
 * a block moved into a different function is flagged and opened.
 */
export function CodeTransfers({ pull, transfers, contents, load }: Props) {
  useEffect(() => {
    const paths = new Set(transfers.flatMap((transfer) => [transfer.fromPath, transfer.toPath]))
    for (const file of pull.files.filter((file) => paths.has(file.path)))
      void load(file.id).catch(() => {})
  }, [pull.files, transfers, load])
  if (!transfers.length) return null
  const views = transfers.map((transfer) => ({
    transfer,
    view: transferView(pull, transfer, contents),
  }))
  const lines = transfers.reduce((total, transfer) => total + transfer.lineCount, 0)
  const moved = views.filter(({ view }) => view.changedSymbol).length
  return (
    <details className="transfers" open={moved > 0 || undefined}>
      <summary className="transfers-summary">
        <ChevronRight size={12} className="transfers-chevron" aria-hidden="true" />
        <span>{transferCounts(transfers)}</span>
        <span className="muted">{`${String(lines)} unchanged ${lines === 1 ? 'line' : 'lines'}`}</span>
        {moved > 0 && (
          <Badge variant="warning">
            {moved === 1 ? '1 changed function' : `${String(moved)} changed functions`}
          </Badge>
        )}
      </summary>
      <div className="transfers-list">
        {views.map(({ transfer, view }) => (
          <details key={transfer.id} open={view.changedSymbol || undefined}>
            <summary>
              <Badge variant={transfer.kind === TransferKind.moved ? 'info' : 'secondary'}>
                {transfer.kind}
              </Badge>
              <EndLabel end={view.from} />
              <ArrowRight size={12} />
              <EndLabel end={view.to} />
              <span className="muted">{transfer.lineCount} unchanged lines</span>
              {view.changedSymbol && (
                <Badge
                  variant="warning"
                  title="Check that the code still holds where it landed: its surrounding function changed."
                >
                  changed function
                </Badge>
              )}
            </summary>
            {view.from.lines.length && view.to.lines.length ? (
              <div className="transfer-ends">
                <TransferSide
                  label={transfer.kind === TransferKind.moved ? 'Was' : 'Copied from'}
                  end={view.from}
                />
                <TransferSide label="Now" end={view.to} />
              </div>
            ) : (
              <pre>{transfer.text}</pre>
            )}
          </details>
        ))}
      </div>
    </details>
  )
}

function EndLabel({ end }: { end: TransferEnd }) {
  return (
    <code>
      {end.path}:{end.line}
      {end.symbol && <span className="transfer-symbol"> in {end.symbol}</span>}
    </code>
  )
}

function TransferSide({ label, end }: { label: string; end: TransferEnd }) {
  return (
    <figure className="transfer-end">
      <figcaption className="muted">
        {label}
        {end.symbol ? ` · ${end.symbol}` : ''}
      </figcaption>
      <pre>
        {end.lines.map((line) => (
          <div key={line.number} data-transferred={line.transferred || undefined}>
            <span className="transfer-line-number">{line.number}</span>
            {line.text}
          </div>
        ))}
      </pre>
    </figure>
  )
}

/** e.g. "9 copied and 2 moved sections". */
function transferCounts(transfers: CodeTransfer[]): string {
  const copied = transfers.filter((transfer) => transfer.kind === TransferKind.copied).length
  const moved = transfers.length - copied
  const parts = [
    ...(copied ? [`${String(copied)} copied`] : []),
    ...(moved ? [`${String(moved)} moved`] : []),
  ]
  return `${parts.join(' and ')} ${transfers.length === 1 ? 'section' : 'sections'}`
}
