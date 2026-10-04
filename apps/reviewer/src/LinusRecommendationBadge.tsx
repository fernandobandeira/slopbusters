import { History } from 'lucide-react'
import { verdictLabels, type LinusRecommendation } from '../shared/linus'
import { Button } from './vendor/t3/components/ui/button'

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
  const summary = `Linus: ${count} recommendation${count === 1 ? '' : 's'}. ${verdictLabels[recommendation.verdict]}.`
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
      <img src="/linus/neutral.png" alt="" />
      {split && <span>Split</span>}
      <span className="tabular-nums">{count}</span>
      {stale && <History size={12} className="muted" aria-hidden="true" />}
    </Button>
  )
}
