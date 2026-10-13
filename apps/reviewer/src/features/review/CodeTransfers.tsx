import { ArrowRight, ChevronRight } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { TransferKind, type CodeTransfer } from '../../../shared/domain/types'

/**
 * Code the PR moved or copied without changing it. It is rarely what needs review, so it sits
 * behind one collapsed line that says how much there is.
 */
export function CodeTransfers({ transfers }: { transfers: CodeTransfer[] }) {
  if (!transfers.length) return null
  const lines = transfers.reduce((total, transfer) => total + transfer.lineCount, 0)
  return (
    <details className="transfers">
      <summary className="transfers-summary">
        <ChevronRight size={12} className="transfers-chevron" aria-hidden="true" />
        <span>{transferCounts(transfers)}</span>
        <span className="muted">{`${String(lines)} unchanged ${lines === 1 ? 'line' : 'lines'}`}</span>
      </summary>
      <div className="transfers-list">
        {transfers.map((transfer) => (
          <details key={transfer.id}>
            <summary>
              <Badge variant={transfer.kind === TransferKind.moved ? 'info' : 'secondary'}>
                {transfer.kind}
              </Badge>
              <code>
                {transfer.fromPath}:{transfer.fromLine}
              </code>
              <ArrowRight size={12} />
              <code>
                {transfer.toPath}:{transfer.toLine}
              </code>
              <span className="muted">{transfer.lineCount} unchanged lines</span>
            </summary>
            <pre>{transfer.text}</pre>
          </details>
        ))}
      </div>
    </details>
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
