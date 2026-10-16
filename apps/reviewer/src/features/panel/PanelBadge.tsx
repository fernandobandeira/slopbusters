import { History, Users } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { panelVerdictLabels, type PanelReviewSummary } from '../../../shared/domain/panel'

/** The latest panel result for a PR; opens the companion on it. */
export function PanelBadge({
  review,
  headSha,
  onOpen,
}: {
  review: PanelReviewSummary
  headSha: string
  onOpen: () => void
}) {
  const stale = review.headSha !== headSha
  const summary = `Review panel: ${panelVerdictLabels[review.verdict]}. ${String(review.findingCount)} findings from ${String(review.reviewers.length)} reviewers.`
  const revision = stale ? ' This PR changed after the panel reviewed it.' : ''
  return (
    <Button
      className="linus-recommendation-badge"
      size="xs"
      variant="outline"
      aria-label={`Open the saved panel review of PR #${String(review.number)}. ${summary}${revision}`}
      title={`${summary}${revision}`}
      onClick={onOpen}
    >
      <Users size={12} aria-hidden="true" />
      <span className="tabular-nums">{review.findingCount}</span>
      {stale && <History size={12} className="muted" aria-hidden="true" />}
    </Button>
  )
}
