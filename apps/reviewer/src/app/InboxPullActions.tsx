import { PullReviewActions, type PullReviewActionsProps } from './PullReviewActions'
import { Button } from '~/components/ui/button'
import { StackBadge } from '../features/stacks/StackBadge'
import { PullStatusIcons, type PullStatusSection } from '../features/pull-status/PullStatusIcons'
import type { InboxPull } from '../../shared/domain/types'
export function InboxPullActions({
  pull,
  recommendation,
  onReplay,
  bobReview,
  onBobReplay,
  onStack,
  onStatus,
  onStartReview,
  reviewStarting,
  reviewStartDisabled,
}: PullReviewActionsProps & {
  pull: InboxPull
  onStack: () => void
  onStatus: (section?: PullStatusSection) => void
}) {
  return (
    <>
      <PullReviewActions
        pull={pull}
        recommendation={recommendation}
        onReplay={onReplay}
        bobReview={bobReview}
        onBobReplay={onBobReplay}
        onStartReview={onStartReview}
        reviewStarting={reviewStarting}
        reviewStartDisabled={reviewStartDisabled}
      />
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
