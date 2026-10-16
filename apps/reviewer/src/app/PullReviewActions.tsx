import { StartReviewButton, type ReviewCompanion } from '../components/StartReviewButton'
import { LinusRecommendationBadge } from '../features/linus/LinusRecommendationBadge'
import { BobReviewBadge } from '../features/bob/BobReviewBadge'
import type { BobReviewSummary } from '../../shared/domain/bob'
import type { PanelReviewSummary } from '../../shared/domain/panel'
import { PanelBadge } from '../features/panel/PanelBadge'
import type { LinusRecommendation } from '../../shared/domain/linus'
import type { InboxPull } from '../../shared/domain/types'

export interface PullReviewActionsProps {
  pull: Pick<InboxPull, 'number' | 'url' | 'headSha'>
  recommendation?: LinusRecommendation
  onReplay: (recommendation: LinusRecommendation) => void
  bobReview?: BobReviewSummary
  onBobReplay: (review: BobReviewSummary) => void
  /** The latest panel result; the PR page shows it with the panel picker instead. */
  panelReview?: PanelReviewSummary
  onPanelReplay?: (review: PanelReviewSummary) => void
  onStartReview?: (companion: ReviewCompanion) => void
  reviewStarting?: boolean
  reviewStartDisabled?: boolean
}

export function PullReviewActions({
  pull,
  recommendation,
  onReplay,
  bobReview,
  onBobReplay,
  panelReview,
  onPanelReplay,
  onStartReview,
  reviewStarting,
  reviewStartDisabled,
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
      {bobReview && (
        <BobReviewBadge
          review={bobReview}
          headSha={pull.headSha}
          onOpen={() => {
            onBobReplay(bobReview)
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
      {onStartReview && (
        <StartReviewButton
          number={pull.number}
          busy={reviewStarting}
          disabled={reviewStartDisabled}
          onStart={onStartReview}
        />
      )}
    </>
  )
}
