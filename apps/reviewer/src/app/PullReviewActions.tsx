import { StartReviewButton, type ReviewCompanion } from '../components/StartReviewButton'
import { LinusRecommendationBadge } from '../features/linus/LinusRecommendationBadge'
import { BobReviewBadge } from '../features/bob/BobReviewBadge'
import type { BobReviewSummary } from '../../shared/domain/bob'
import type { LinusRecommendation } from '../../shared/domain/linus'
import type { InboxPull } from '../../shared/domain/types'

export interface PullReviewActionsProps {
  pull: Pick<InboxPull, 'number' | 'url' | 'headSha'>
  recommendation?: LinusRecommendation
  onReplay: (recommendation: LinusRecommendation) => void
  bobReview?: BobReviewSummary
  onBobReplay: (review: BobReviewSummary) => void
  onStartReview?: (companion: ReviewCompanion) => void
  reviewStarting?: boolean
  reviewStartDisabled?: boolean
  startCompanion?: ReviewCompanion
}

export function PullReviewActions({
  pull,
  recommendation,
  onReplay,
  bobReview,
  onBobReplay,
  onStartReview,
  reviewStarting,
  reviewStartDisabled,
  startCompanion,
}: PullReviewActionsProps) {
  return (
    <>
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
          companion={startCompanion}
          onStart={onStartReview}
        />
      )}
    </>
  )
}
