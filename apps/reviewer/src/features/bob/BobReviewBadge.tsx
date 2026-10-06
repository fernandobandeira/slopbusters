import { History } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { bobVerdictLabels, type BobReviewSummary } from '../../../shared/domain/bob'

export function BobReviewBadge({
  review,
  headSha,
  onOpen,
  showLabel = false,
}: {
  review: BobReviewSummary
  headSha: string
  onOpen: () => void
  showLabel?: boolean
}) {
  const stale = review.headSha !== headSha
  const summary = `Uncle Bob: ${bobVerdictLabels[review.verdict]}. ${review.findingCount} findings.`
  const revision = stale ? ' This PR changed after Uncle Bob reviewed it.' : ''
  return (
    <Button
      className="linus-recommendation-badge"
      size={showLabel ? 'sm' : 'xs'}
      variant="outline"
      aria-label={`Open saved Uncle Bob review for PR #${review.number}. ${summary}${revision}`}
      title={`${summary}${revision}`}
      onClick={onOpen}
    >
      <img src="/unclebob/neutral.png" alt="" />
      {showLabel && <span>Ask Uncle Bob</span>}
      <span className="tabular-nums">{review.findingCount}</span>
      {stale && <History size={12} className="muted" aria-hidden="true" />}
    </Button>
  )
}
