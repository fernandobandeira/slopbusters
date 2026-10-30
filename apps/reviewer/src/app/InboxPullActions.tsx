import { PullReviewActions, type PullReviewActionsProps } from './PullReviewActions'
import { Button } from '~/components/ui/button'
import { StackBadge } from '../components/StackBadge'
import { PullStatusIcons, type PullStatusSection } from '../components/PullStatusIcons'
import type { InboxPull } from '../../shared/domain/types'
import type { ActivePanel } from '../../shared/domain/panel'
import { PanelActivityBadge } from '../features/panel/PanelActivityBadge'
export function InboxPullActions({
  pull,
  recommendation,
  onReplay,
  bobReview,
  onBobReplay,
  panelReview,
  onPanelReplay,
  activePanel,
  onActivePanel,
  onStack,
  onStatus,
}: PullReviewActionsProps & {
  pull: InboxPull
  /** The PR's panel that has not finished, shown until its result takes the place. */
  activePanel?: ActivePanel
  onActivePanel: (panel: ActivePanel) => void
  onStack: () => void
  onStatus: (section?: PullStatusSection) => void
}) {
  return (
    <>
      {activePanel && (
        <PanelActivityBadge
          panel={activePanel}
          onOpen={() => {
            onActivePanel(activePanel)
          }}
        />
      )}
      <PullReviewActions
        pull={pull}
        recommendation={recommendation}
        onReplay={onReplay}
        bobReview={bobReview}
        onBobReplay={onBobReplay}
        panelReview={panelReview}
        onPanelReplay={onPanelReplay}
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
