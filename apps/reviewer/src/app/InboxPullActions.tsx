import { Button } from '~/components/ui/button'
import { LinusRecommendationBadge } from '../features/linus/LinusRecommendationBadge'
import { StackBadge } from '../features/stacks/StackBadge'
import { PullStatusIcons, type PullStatusSection } from '../features/pull-status/PullStatusIcons'
import type { LinusRecommendation } from '../../shared/domain/linus'
import type { InboxPull } from '../../shared/domain/types'
export function InboxPullActions({
  pull,
  recommendation,
  onReplay,
  onStack,
  onStatus,
}: {
  pull: InboxPull
  recommendation?: LinusRecommendation
  onReplay: (recommendation: LinusRecommendation) => void
  onStack: () => void
  onStatus: (section?: PullStatusSection) => void
}) {
  return (
    <>
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
