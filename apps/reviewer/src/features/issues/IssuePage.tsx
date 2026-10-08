import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowUpRight, GitPullRequest } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { getTicket } from '../../../shared/api/tickets'
import type { Ticket } from '../../../shared/domain/tickets'
import { TicketMarkdown } from '../../components/TicketMarkdown'
import { issuePath, issuesPath, reviewPath } from '../../lib/routes'
import { useApiQuery } from '../../lib/useApiQuery'
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
        <IssueHeader ticket={ticket} />
        <IssueFamily ticket={ticket} />
        {ticket.description.trim() ? (
          <TicketMarkdown markdown={ticket.description} label="Issue description" />
        ) : (
          <p className="muted">This issue has no description yet.</p>
        )}
      </section>
      <aside className="issue-review">{renderReview(ticket, query.reload)}</aside>
    </div>
  )
}

function IssueHeader({ ticket }: { ticket: Ticket }) {
  return (
    <header className="issue-header">
      <div className="issue-meta muted">
        <span>{ticket.identifier}</span>
        <Badge variant="outline">{ticket.state.name}</Badge>
        {ticket.assignee && <span>{ticket.assignee}</span>}
        {ticket.project && <span>{ticket.project}</span>}
        {ticket.labels.map((label) => (
          <Badge key={label} variant="secondary">
            {label}
          </Badge>
        ))}
        <a href={ticket.url} target="_blank" rel="noreferrer" title="Open in Linear">
          Linear <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
      <h1>{ticket.title}</h1>
    </header>
  )
}

function IssueFamily({ ticket }: { ticket: Ticket }) {
  if (!ticket.parentTicket && !ticket.children.length && !ticket.pulls.length) return null
  return (
    <div className="issue-family">
      {ticket.parentTicket && (
        <p>
          Part of{' '}
          <Link to={issuePath(ticket.parentTicket.identifier)}>
            {ticket.parentTicket.identifier} {ticket.parentTicket.title}
          </Link>
        </p>
      )}
      {ticket.pulls.length > 0 && (
        <ul aria-label="Linked pull requests">
          {ticket.pulls.map((pull) => (
            <li key={pull.url}>
              <GitPullRequest size={14} aria-hidden="true" />
              <Link to={reviewPath({ url: pull.url, filter: 'mine' })}>
                {pull.repository}#{pull.number} {pull.title}
              </Link>
              <span className="muted"> · {pull.state}</span>
            </li>
          ))}
        </ul>
      )}
      {ticket.children.length > 0 && (
        <details className="issue-children" open={ticket.children.length <= 12}>
          <summary>{ticket.children.length} sub-issues</summary>
          <ul>
            {ticket.children.map((child) => (
              <li key={child.identifier}>
                <Link to={issuePath(child.identifier)}>
                  {child.identifier} {child.title}
                </Link>
                <span className="muted">
                  {' '}
                  · {child.state.name}
                  {child.pullUrls.length ? ` · ${String(child.pullUrls.length)} PR` : ' · no PR'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
