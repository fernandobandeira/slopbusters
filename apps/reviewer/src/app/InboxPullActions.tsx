import { Button } from '~/components/ui/button'
import { LinusRecommendationBadge } from '../features/linus/LinusRecommendationBadge'
import { BobReviewBadge } from '../features/bob/BobReviewBadge'
import type { BobReviewSummary } from '../../shared/domain/bob'
import { StackBadge } from '../features/stacks/StackBadge'
import { PullStatusIcons, type PullStatusSection } from '../features/pull-status/PullStatusIcons'
import type { LinusRecommendation } from '../../shared/domain/linus'
import type { InboxPull } from '../../shared/domain/types'
export function InboxPullActions({
  pull,
  recommendation,
  onReplay,
  bobReview,
  onBobReplay,
  onStack,
  onStatus,
}: {
  pull: InboxPull
  recommendation?: LinusRecommendation
  onReplay: (recommendation: LinusRecommendation) => void
  bobReview?: BobReviewSummary
  onBobReplay: (review: BobReviewSummary) => void
  onStack: () => void
  onStatus: (section?: PullStatusSection) => void
}) {
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
      {pull.stack && <StackBadge summary={pull.stack} onClick={onStack} />}
      {pull.status ? (
        <PullStatusIcons status={pull.status} onSelect={onStatus} />
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            onStatus()
          }}
        >
          Checks and reviews
        </Button>
      )}
    </>
  )
}
