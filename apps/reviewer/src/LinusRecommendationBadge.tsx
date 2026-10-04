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
  return (
    <Button
      className="linus-recommendation-badge"
      size="xs"
      variant="outline"
      aria-label={`Open Linus recommendations for PR #${recommendation.number}`}
      title={
        stale
          ? 'This PR changed after Linus reviewed it. Open the saved recommendations.'
          : 'Replay Linus’s review and copy the recommendations.'
      }
      onClick={onOpen}
    >
      <img src="/linus/neutral.png" alt="" />
      {verdictLabels[recommendation.verdict]}
      {stale && <span className="muted"> · older revision</span>}
    </Button>
  )
}
