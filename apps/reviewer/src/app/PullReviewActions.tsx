import { LinusRecommendationBadge } from '../features/linus/LinusRecommendationBadge'
import type { PanelReviewSummary } from '../../shared/domain/panel'
import { PanelBadge } from '../features/panel/PanelBadge'
import type { LinusRecommendation } from '../../shared/domain/linus'
import type { InboxPull } from '../../shared/domain/types'

export interface PullReviewActionsProps {
  pull: Pick<InboxPull, 'number' | 'url' | 'headSha'>
  recommendation?: LinusRecommendation
  onReplay: (recommendation: LinusRecommendation) => void
  /** The latest panel result; the PR page shows it with the panel picker instead. */
  panelReview?: PanelReviewSummary
  onPanelReplay?: (review: PanelReviewSummary) => void
}

export function PullReviewActions({
  pull,
  recommendation,
  onReplay,
  panelReview,
  onPanelReplay,
}: PullReviewActionsProps) {
  return (
    <>
      {panelReview && onPanelReplay && (
        <PanelBadge
          review={panelReview}
          headSha={pull.headSha}
          onOpen={() => {
            onPanelReplay(panelReview)
          }}
        />
      )}
      {recommendation && (
        <LinusRecommendationBadge
          recommendation={recommendation}
          headSha={pull.headSha}
          onOpen={() => {
            onReplay(recommendation)
          }}
        />
      )}
    </>
  )
}
