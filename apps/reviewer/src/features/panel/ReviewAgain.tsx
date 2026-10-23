import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import { seatRequests } from '../../../shared/domain/panel'
import type { PanelSession } from '../../../shared/domain/panelSession'
import { call, message } from '../../lib/api'

interface Props {
  session: PanelSession
  url: string
  onOpen: (sessionId: string) => void
}

/** Start a new panel on the PR's current commits, with the same reviewers. */
function useReviewAgain({ session, url, onOpen }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function start() {
    setBusy(true)
    setError('')
    try {
      const reviewers = seatRequests(session.reviewers, session.model.provider)
      const next = await call(routes.startPanel, {
        body: { repository: session.repository, urls: [url], reviewers },
      })
      onOpen(next.id)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, start: () => void start() }
}

/**
 * The PR moved on after the panel read it. Its findings still read, but their lines may have moved,
 * so comments and line guidance wait for a panel on the current commits.
 */
export function OutdatedReview(props: Props & { reviewedSha: string; currentSha: string }) {
  const again = useReviewAgain(props)
  const moved = props.reviewedSha !== props.currentSha
  return (
    <div className="linus-notice panel-outdated" role="status">
      <p>
        {moved ? (
          <>
            <strong>New commits since this review.</strong> The panel reviewed{' '}
            <code>{props.reviewedSha.slice(0, 7)}</code>; the PR is now at{' '}
            <code>{props.currentSha.slice(0, 7)}</code>.
          </>
        ) : (
          <strong>The PR's title or description changed since this review.</strong>
        )}{' '}
        Comments and line guidance are off until the panel reviews the PR as it is now.
      </p>
      <Button size="sm" disabled={again.busy} onClick={again.start}>
        {again.busy && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        Review the current PR
      </Button>
      {again.error && <p role="alert">{again.error}</p>}
    </div>
  )
}

export function ReviewAgain(props: Props) {
  const again = useReviewAgain(props)
  return (
    <div className="linus-footer">
      <button disabled={again.busy} onClick={again.start}>
        Review this PR again with the same panel
      </button>
      {again.error && <p role="alert">{again.error}</p>}
    </div>
  )
}

/** A round over local fix commits: GitHub has another head, so comments stay off by design. */
export function LocalRoundNotice({ session }: { session: PanelSession }) {
  const { local } = session
  if (!local) return null
  return (
    <div className="linus-notice panel-outdated" role="status">
      <p>
        <strong>Reviewing local fixes.</strong> This round read <code>{local.branch}</code> at{' '}
        <code>{local.sha.slice(0, 7)}</code>, which is not pushed; it started from{' '}
        <code>{local.reviewedSha.slice(0, 7)}</code>. Comments and line guidance are off, since
        GitHub would place them against its own head. Send fixes again to continue from this commit.
      </p>
    </div>
  )
}
