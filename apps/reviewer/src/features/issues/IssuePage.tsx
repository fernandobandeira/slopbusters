import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowUpRight, GitPullRequest } from 'lucide-react'
import { getTicket } from '../../../shared/api/tickets'
import type { Ticket } from '../../../shared/domain/tickets'
import { TicketMarkdown } from '../../components/TicketMarkdown'
import { issuePath, issuesPath, reviewPath } from '../../lib/routes'
import { useApiQuery } from '../../lib/useApiQuery'
import {
  BlockerChips,
  IssueLabels,
  IssueReferenceLine,
  PriorityIcon,
  ProgressChip,
  PullCount,
  StatusIcon,
} from './IssueParts'
import './issues.css'

export function IssuePage({
  identifier,
  refresh,
  renderReview,
}: {
  identifier: string
  refresh: number
  renderReview: (ticket: Ticket, reload: () => void) => ReactNode
}) {
  const query = useApiQuery(getTicket, { params: { identifier } }, { refresh })
  const ticket = query.data
  if (query.error)
    return (
      <div className="empty-state" role="alert">
        <strong>{query.error}</strong>
        <Link to={issuesPath()}>Back to issues</Link>
      </div>
    )
  if (!ticket)
    return (
      <div className="empty-state" role="status">
        Loading {identifier}…
      </div>
    )
  return (
    <div className="issue-page">
      <section className="issue-document" aria-label={`${ticket.identifier} in Linear`}>
        <Link className="back-to-inbox" to={issuesPath()}>
          <ArrowLeft size={14} /> All issues
        </Link>
        {ticket.parent && (
          <Link className="issue-breadcrumb muted" to={issuePath(ticket.parent.identifier)}>
            Part of <StatusIcon state={ticket.parent.state} />
            <span>{ticket.parent.identifier}</span>
            <span className="issue-title">{ticket.parent.title}</span>
            <ProgressChip progress={ticket.parent.progress} />
          </Link>
        )}
        <IssueHeader ticket={ticket} actions={renderReview(ticket, query.reload)} />
        <IssueRelations ticket={ticket} />
        {ticket.description.trim() ? (
          <TicketMarkdown markdown={ticket.description} label="Issue description" />
        ) : (
          <p className="muted">This issue has no description yet.</p>
        )}
      </section>
    </div>
  )
}

function IssueHeader({ ticket, actions }: { ticket: Ticket; actions: ReactNode }) {
  return (
    <header className="issue-header">
      <div className="issue-heading">
        <h1>{ticket.title}</h1>
        <div className="issue-header-actions">{actions}</div>
      </div>
      <div className="issue-meta">
        <span className="issue-chip">{ticket.identifier}</span>
        <span className="issue-chip" style={{ color: ticket.state.color }}>
          <StatusIcon state={ticket.state} />
          <span className="issue-state-name">{ticket.state.name}</span>
        </span>
        {ticket.priority > 0 && (
          <span className="issue-chip">
            <PriorityIcon priority={ticket.priority} />
          </span>
        )}
        <BlockerChips blockedBy={ticket.blockedBy} blocking={ticket.blocking} />
        <IssueLabels labels={ticket.labels} />
        {ticket.assignee && <span className="muted">{ticket.assignee}</span>}
        {ticket.project && <span className="muted">{ticket.project}</span>}
        <a href={ticket.url} target="_blank" rel="noreferrer" title="Open in Linear">
          Linear <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </header>
  )
}

/** What holds this issue up, what it holds up, its sub-issues and its pull requests. */
function IssueRelations({ ticket }: { ticket: Ticket }) {
  const { blockedBy, blocking, children, pulls } = ticket
  if (!blockedBy.length && !blocking.length && !children.length && !pulls.length) return null
  return (
    <div className="issue-family">
      {blockedBy.length > 0 && (
        <IssueSection title="Blocked by" tone="blocked">
          {blockedBy.map((issue) => (
            <IssueReferenceLine key={issue.identifier} issue={issue} />
          ))}
        </IssueSection>
      )}
      {blocking.length > 0 && (
        <IssueSection title="Blocking" tone="blocking">
          {blocking.map((issue) => (
            <IssueReferenceLine key={issue.identifier} issue={issue} />
          ))}
        </IssueSection>
      )}
      {children.length > 0 && (
        <IssueSection
          title="Sub-issues"
          extra={<ProgressChip progress={ticket.progress} />}
          collapsible={children.length > 12}
        >
          {children.map((child) => (
            <IssueReferenceLine key={child.identifier} issue={child}>
              <BlockerChips blockedBy={child.blockedBy} blocking={[]} />
              <span className="issue-spacer" />
              <PullCount count={child.pullUrls.length} />
            </IssueReferenceLine>
          ))}
        </IssueSection>
      )}
      {pulls.length > 0 && (
        <IssueSection title="Pull requests">
          {pulls.map((pull) => (
            <Link
              key={pull.url}
              className="issue-line"
              to={reviewPath({ url: pull.url, filter: 'mine' })}
            >
              <span className="issue-identifier">#{pull.number}</span>
              <GitPullRequest size={14} className="issue-pull-icon" data-state={pull.state} />
              <span className="issue-title">{pull.title || pull.url}</span>
              <span className="issue-spacer" />
              <span className="muted">
                {pull.repository} · {pull.state}
              </span>
            </Link>
          ))}
        </IssueSection>
      )}
    </div>
  )
}

function IssueSection({
  title,
  tone,
  extra,
  collapsible = false,
  children,
}: {
  title: string
  tone?: 'blocked' | 'blocking'
  extra?: ReactNode
  collapsible?: boolean
  children: ReactNode
}) {
  return (
    <details className="issue-section" data-tone={tone} open={!collapsible}>
      <summary>
        {title}
        {extra}
      </summary>
      {children}
    </details>
  )
}
