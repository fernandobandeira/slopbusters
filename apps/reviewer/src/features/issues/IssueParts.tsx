import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CircleAlert, CircleMinus, GitPullRequest } from 'lucide-react'
import type {
  TicketProgress,
  TicketReference,
  TicketState,
  TicketSummary,
} from '../../../shared/domain/tickets'
import { issuePath } from '../../lib/routes'

/** Linear's status glyph: dashed for backlog, empty to do, half-filled in progress, filled done. */
export function StatusIcon({ state }: { state: TicketState }) {
  const color = state.color || 'currentColor'
  const label = state.name
  if (state.type === 'completed' || state.type === 'canceled')
    return (
      <svg className="issue-status-icon" viewBox="0 0 14 14" role="img" aria-label={label}>
        <circle cx="7" cy="7" r="6" fill={color} />
        <path
          d={
            state.type === 'completed' ? 'M4.3 7.2 6.1 9l3.6-3.8' : 'M4.8 4.8l4.4 4.4m0-4.4-4.4 4.4'
          }
          fill="none"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  return (
    <svg className="issue-status-icon" viewBox="0 0 14 14" role="img" aria-label={label}>
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={state.type === 'backlog' ? '1.4 1.6' : undefined}
      />
      {state.type === 'started' && <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={color} />}
      {state.type === 'triage' && <circle cx="7" cy="7" r="2" fill={color} />}
    </svg>
  )
}

const priorityNames = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

/** Linear's priority bars: three for high, two for medium, one for low, a badge for urgent. */
export function PriorityIcon({ priority }: { priority: number }) {
  const label = priorityNames[priority] ?? 'No priority'
  if (priority === 1)
    return (
      <svg className="issue-priority-icon urgent" viewBox="0 0 14 14" role="img" aria-label={label}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4M7 10v.2" stroke="var(--background)" strokeWidth="1.6" />
      </svg>
    )
  const filled = priority === 0 ? 0 : 5 - priority
  return (
    <svg className="issue-priority-icon" viewBox="0 0 14 14" role="img" aria-label={label}>
      {[0, 1, 2].map((bar) =>
        priority === 0 ? (
          <rect key={bar} x={1.5 + bar * 4} y="6.3" width="3" height="1.4" rx="0.5" />
        ) : (
          <rect
            key={bar}
            x={1.5 + bar * 4}
            y={9 - bar * 3}
            width="3"
            height={4 + bar * 3}
            rx="0.8"
            opacity={bar < filled ? 1 : 0.3}
          />
        ),
      )}
    </svg>
  )
}

export function IssueLabels({ labels }: { labels: TicketSummary['labels'] }) {
  return labels.map((label) => (
    <span key={label.name} className="issue-chip issue-label">
      <span className="issue-label-dot" style={{ background: label.color }} />
      {label.name}
    </span>
  ))
}

/** Red when something unfinished holds this issue up; amber when this issue holds others up. */
export function BlockerChips({
  blockedBy,
  blocking,
}: {
  blockedBy: TicketReference[]
  blocking: TicketReference[]
}) {
  return (
    <>
      {blockedBy.length > 0 && (
        <span
          className="issue-chip issue-blocked"
          title={`Blocked by\n${describe(blockedBy)}`}
          aria-label={`Blocked by ${blockedBy.map((issue) => issue.identifier).join(', ')}`}
        >
          <CircleMinus size={13} aria-hidden="true" />
          {blockedBy.length}
        </span>
      )}
      {blocking.length > 0 && (
        <span
          className="issue-chip issue-blocking"
          title={`Blocking\n${describe(blocking)}`}
          aria-label={`Blocking ${blocking.map((issue) => issue.identifier).join(', ')}`}
        >
          <CircleAlert size={13} aria-hidden="true" />
          {blocking.length}
        </span>
      )}
    </>
  )
}

function describe(issues: TicketReference[]) {
  return issues
    .map((issue) => `${issue.identifier} · ${issue.state.name} · ${issue.title}`)
    .join('\n')
}

/** Sub-issues finished out of total, drawn as a ring like Linear's. */
export function ProgressChip({ progress }: { progress: TicketProgress }) {
  if (!progress.total) return null
  const fraction = progress.done / progress.total
  const circumference = 2 * Math.PI * 5
  return (
    <span
      className="issue-chip issue-progress"
      title={`${String(progress.done)} of ${String(progress.total)} sub-issues done`}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" opacity="0.3" />
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray={`${String(fraction * circumference)} ${String(circumference)}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
      {progress.done}/{progress.total}
    </span>
  )
}

export function PullCount({ count }: { count: number }) {
  if (!count) return <span className="issue-chip issue-no-pull">No PR</span>
  return (
    <span className="issue-chip" title="Linked pull requests">
      <GitPullRequest size={12} aria-hidden="true" />
      {count}
    </span>
  )
}

/** One compact line for an issue that is only known by reference: a parent, blocker or child. */
export function IssueReferenceLine({
  issue,
  children,
}: {
  issue: TicketReference
  children?: ReactNode
}) {
  return (
    <Link className="issue-line" to={issuePath(issue.identifier)}>
      <span className="issue-identifier">{issue.identifier}</span>
      <StatusIcon state={issue.state} />
      <span className="issue-title">{issue.title}</span>
      {children}
    </Link>
  )
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
