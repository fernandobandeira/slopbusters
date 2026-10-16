import { useEffect, useEffectEvent } from 'react'
import type { PanelReviewSummary } from '../../shared/domain/panel'
import type { Provider } from '../../shared/domain/types'
import { ActivePanelButton } from '../features/panel/ActivePanelButton'
import { PanelBadge } from '../features/panel/PanelBadge'
import { PanelPicker } from '../features/panel/PanelPicker'
import { useActivePanel } from '../features/panel/useActivePanel'

/**
 * The PR header's panel actions: the latest panel result, and asking the panel again. While a
 * panel is still working on the PR, it takes the picker's place and opens that panel instead.
 */
export function PullPanelActions({
  repository,
  pull,
  provider,
  review,
  onOpen,
  onSettled,
  asking = false,
  onDismissAsk,
}: {
  repository: string
  pull: { url: string; number: number; headSha: string }
  provider?: Provider
  review?: PanelReviewSummary
  onOpen: (sessionId: string) => void
  /** A panel on this PR stopped running, so its saved result may have changed. */
  onSettled?: () => void
  /** Open the picker straight away, as when the PR list asked for the panel. */
  asking?: boolean
  onDismissAsk?: () => void
}) {
  const active = useActivePanel({ repository, url: pull.url, onSettled })
  const working = active.session
  const openWorking = useEffectEvent((id: string) => {
    onOpen(id)
  })
  const workingId = working?.id
  useEffect(() => {
    // Asking for the panel while one is already working on this PR shows that one.
    if (asking && workingId) openWorking(workingId)
  }, [asking, workingId])
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
      {working ? (
        <ActivePanelButton
          session={working}
          number={pull.number}
          onOpen={() => {
            onOpen(working.id)
          }}
        />
      ) : (
        !(asking && active.loading) && (
          <PanelPicker
            repository={repository}
            pull={pull}
            provider={provider}
            onOpen={(sessionId) => {
              active.reload()
              onOpen(sessionId)
            }}
            openOnMount={asking}
            onClose={onDismissAsk}
          />
        )
      )}
    </>
  )
}
