import { History } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { bobVerdictLabels, type BobReviewSummary } from '../../../shared/domain/bob'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'

export function BobReviewBadge({
  review,
  headSha,
  onOpen,
}: {
  review: BobReviewSummary
  headSha: string
  onOpen: () => void
}) {
  const stale = review.headSha !== headSha
  const summary = `Uncle Bob: ${bobVerdictLabels[review.verdict]}. ${review.findingCount} findings.`
  const revision = stale ? ' This PR changed after Uncle Bob reviewed it.' : ''
  return (
    <Button
      className="linus-recommendation-badge"
      size="xs"
      variant="outline"
      aria-label={`Open saved Uncle Bob review for PR #${review.number}. ${summary}${revision}`}
      title={`${summary}${revision}`}
      onClick={onOpen}
    >
      <ReviewerFace name="Uncle Bob" src={personaFaceSrc('unclebob', 'neutral')} size={18} />
      <span className="tabular-nums">{review.findingCount}</span>
      {stale && <History size={12} className="muted" aria-hidden="true" />}
    </Button>
  )
}
