import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, CircleDot, GitPullRequest } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import type { TicketSummary } from '../../../shared/domain/tickets'
import { issuePath } from '../../lib/routes'

export function IssueRow({ ticket, badge }: { ticket: TicketSummary; badge?: ReactNode }) {
  const pulls = ticket.pullUrls.length
  return (
    <div className="pr-row issue-row">
      <Link className="pr-row-link" to={issuePath(ticket.identifier)}>
        <CircleDot size={18} className="issue-state-icon" data-state={ticket.state.type} />
        <div>
          <strong>{ticket.title}</strong>
          <span className="muted">
            {ticket.identifier} · {ticket.state.name}
            {ticket.project ? ` · ${ticket.project}` : ''}
            {ticket.parent ? ` · part of ${ticket.parent}` : ''} · updated{' '}
            {new Date(ticket.updatedAt).toLocaleDateString()}
          </span>
        </div>
        {pulls ? (
          <Badge variant="outline" title="Linked pull requests">
            <GitPullRequest size={12} aria-hidden="true" /> {pulls}
          </Badge>
        ) : (
          <Badge variant="outline">No PR yet</Badge>
        )}
      </Link>
      {badge}
      <a
        className="pr-external-link muted"
        href={ticket.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${ticket.identifier} in Linear`}
        title="Open in Linear"
      >
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </div>
  )
}
