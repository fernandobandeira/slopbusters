import type { PanelReviewSummary } from '../../shared/domain/panel'
import type { Provider } from '../../shared/domain/types'
import { PanelBadge } from '../features/panel/PanelBadge'
import { PanelPicker } from '../features/panel/PanelPicker'

/** The PR header's panel actions: the latest panel result, and asking the panel again. */
export function PullPanelActions({
  repository,
  pull,
  provider,
  review,
  onOpen,
  asking = false,
  onDismissAsk,
}: {
  repository: string
  pull: { url: string; number: number; headSha: string }
  provider?: Provider
  review?: PanelReviewSummary
  onOpen: (sessionId: string) => void
  /** Open the picker straight away, as when the PR list asked for the panel. */
  asking?: boolean
  onDismissAsk?: () => void
}) {
  return (
    <>
      {review && (
        <PanelBadge
          review={review}
          headSha={pull.headSha}
          onOpen={() => {
            onOpen(review.sessionId)
          }}
        />
      )}
      <PanelPicker
        repository={repository}
        pull={pull}
        provider={provider}
        onOpen={onOpen}
        openOnMount={asking}
        onClose={onDismissAsk}
      />
    </>
  )
}
