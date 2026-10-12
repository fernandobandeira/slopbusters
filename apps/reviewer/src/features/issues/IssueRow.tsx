import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import type { TicketSummary } from '../../../shared/domain/tickets'
import { issuePath } from '../../lib/routes'
import {
  BlockerChips,
  IssueLabels,
  IssueReferenceLine,
  PriorityIcon,
  ProgressChip,
  PullCount,
  StatusIcon,
  shortDate,
} from './IssueParts'
import { isListed, type IssueGroup } from './issueGroups'

/** A parent and its sub-issues, drawn as a tree. */
export function IssueGroupRows({
  group,
  renderBadge,
}: {
  group: IssueGroup
  renderBadge: (ticket: TicketSummary) => ReactNode
}) {
  const { head, children } = group
  return (
    <div className="issue-group">
      {isListed(head) ? (
        <IssueRow ticket={head} badge={renderBadge(head)} />
      ) : (
        <div className="issue-row issue-parent-reference">
          <IssueReferenceLine issue={head}>
            <ProgressChip progress={head.progress} />
            <span className="issue-spacer" />
            <span className="muted issue-note">Parent · not assigned to you</span>
          </IssueReferenceLine>
        </div>
      )}
      {children.map((child) => (
        <IssueRow key={child.identifier} ticket={child} nested badge={renderBadge(child)} />
      ))}
    </div>
  )
}

function IssueRow({
  ticket,
  nested = false,
  badge,
}: {
  ticket: TicketSummary
  nested?: boolean
  badge?: ReactNode
}) {
  return (
    <div className={`issue-row${nested ? ' issue-row-nested' : ''}`}>
      <Link className="issue-line" to={issuePath(ticket.identifier)}>
        <PriorityIcon priority={ticket.priority} />
        <span className="issue-identifier">{ticket.identifier}</span>
        <StatusIcon state={ticket.state} />
        <span className="issue-title" title={ticket.title}>
          {ticket.title}
        </span>
        <ProgressChip progress={ticket.progress} />
        <BlockerChips blockedBy={ticket.blockedBy} blocking={ticket.blocking} />
        <span className="issue-spacer" />
        <span className="issue-row-labels">
          <IssueLabels labels={ticket.labels} />
        </span>
        <PullCount count={ticket.pullUrls.length} />
        <span className="issue-date muted" title={`Updated ${ticket.updatedAt}`}>
          {shortDate(ticket.updatedAt)}
        </span>
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
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </div>
  )
}
