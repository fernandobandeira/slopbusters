import { Layers } from 'lucide-react'
import type { PullStackSummary } from '../shared/stacks'
import './stacks.css'

interface Props {
  summary: PullStackSummary
  onClick?: () => void
  compact?: boolean
}

export function StackBadge({ summary, onClick, compact = false }: Props) {
  const label = `Pull request ${summary.position} of ${summary.size} in this stack`
  const title = summary.source === 'derived' ? `${label}. Based on branch dependencies.` : label
  const contents = (
    <>
      <Layers size={12} aria-hidden="true" />
      {!compact && <span>Stack</span>}
      <span className="stack-position">
        {summary.position}/{summary.size}
      </span>
    </>
  )

  if (!onClick)
    return (
      <span className="stack-badge" title={title} aria-label={label}>
        {contents}
      </span>
    )
  return (
    <button
      type="button"
      className="stack-badge"
      title={title}
      aria-label={`View stack: ${label.toLowerCase()}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      {contents}
    </button>
  )
}
