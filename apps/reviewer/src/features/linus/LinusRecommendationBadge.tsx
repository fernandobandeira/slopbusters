import { History } from 'lucide-react'
import { verdictLabels, type LinusRecommendation } from '../../../shared/domain/linus'
import { Button } from '~/components/ui/button'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'

export function LinusRecommendationBadge({
  recommendation,
  headSha,
  onOpen,
}: {
  recommendation: LinusRecommendation
  headSha: string
  onOpen: () => void
}) {
  const stale = recommendation.headSha !== headSha
  const split = recommendation.verdict === 'stack' || recommendation.verdict === 'separate'
  const count = recommendation.recommendationCount
  const waiting = recommendation.panel === 'waiting'
  const summary = `Linus: ${count} recommendation${count === 1 ? '' : 's'}. ${verdictLabels[recommendation.verdict]}.${waiting ? ' The panel is waiting on you.' : ''}`
  const revision = stale ? ' This PR changed after Linus reviewed it.' : ''
  return (
    <Button
      className="linus-recommendation-badge"
      size="xs"
      variant="outline"
      aria-label={`Open Linus recommendations for PR #${recommendation.number}. ${summary}${revision}`}
      title={`${summary}${revision} Replay Linus’s review and copy the recommendations.`}
      onClick={onOpen}
    >
      <ReviewerFace name="Linus" src={personaFaceSrc('linus', 'neutral')} size={18} />
      {split && <span>Split</span>}
      <span className="tabular-nums">{count}</span>
      {waiting && <span className="linus-panel-waiting">Panel waiting</span>}
      {stale && <History size={12} className="muted" aria-hidden="true" />}
    </Button>
  )
}
