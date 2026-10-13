import { Link } from 'react-router'
import { FileText } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { jobsReviews } from '../../shared/api/jobs'
import { ticketForPull } from '../../shared/api/tickets'
import { jobsVerdictLabels, type JobsReviewSummary } from '../../shared/domain/jobs'
import type { TicketView } from '../../shared/domain/tickets'
import { AgentSessionCard } from '../features/agent-sessions/AgentSessionCard'
import { IssuePage } from '../features/issues/IssuePage'
import { IssuesPage } from '../features/issues/IssuesPage'
import { JobsPanel } from '../features/jobs/JobsPanel'
import { issuePath } from '../lib/routes'
import { useApiQuery } from '../lib/useApiQuery'

const verdictVariant = { ready: 'success', 'needs-work': 'warning', uncertain: 'outline' } as const

function ReadinessBadge({ review }: { review: JobsReviewSummary }) {
  const open = review.questionCount
  return (
    <Badge
      variant={review.applied ? 'outline' : verdictVariant[review.verdict]}
      title={`Steve Jobs reviewed this ticket on ${new Date(review.createdAt).toLocaleString()}`}
    >
      {review.applied ? 'Applied' : jobsVerdictLabels[review.verdict]}
      {!review.applied && open > 0 ? ` · ${String(open)} open` : ''}
    </Badge>
  )
}

export function IssuesRoute({ view }: { view: TicketView }) {
  const reviews = useApiQuery(jobsReviews, {})
  const byTicket = new Map(reviews.data?.reviews.map((review) => [review.ticket, review]))
  return (
    <IssuesPage
      view={view}
      renderBadge={(ticket) => {
        const review = byTicket.get(ticket.identifier)
        return review ? <ReadinessBadge review={review} /> : null
      }}
    />
  )
}

export function IssueRoute({ identifier, repository }: { identifier: string; repository: string }) {
  return (
    <IssuePage
      key={identifier}
      identifier={identifier}
      refresh={0}
      renderReview={(ticket, reload) => (
        <JobsPanel
          ticket={ticket}
          repository={ticket.pulls[0]?.repository ?? repository}
          onApplied={reload}
          renderSessionCard={(session) => (
            <AgentSessionCard sessionId={session.id} repository={session.repository} />
          )}
        />
      )}
    />
  )
}

/** The Linear issue a PR implements, shown beside the review actions when one is linked. */
export function LinkedTicketLink({ url }: { url: string }) {
  const query = useApiQuery(ticketForPull, { query: { url } })
  const identifier = query.data?.identifier
  if (!identifier) return null
  return (
    <Link className="linked-ticket" to={issuePath(identifier)} title="Open the linked issue">
      <FileText size={14} aria-hidden="true" />
      {identifier}
    </Link>
  )
}
