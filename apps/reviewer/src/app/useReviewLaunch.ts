import { useRef, useState } from 'react'
import * as routes from '../../shared/api'
import { blocksNewReview, reviewedPullsLabel } from '../../shared/domain/reviewSession'
import type { ReviewCompanion } from '../components/StartReviewButton'
import { call, message } from '../lib/api'
import { useApiQuery } from '../lib/useApiQuery'

interface LaunchedSession {
  id: string
  urls: string[]
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
}

/**
 * Starts Linus and keeps the review that blocks a new one reachable: a running or partial Linus
 * review reopens after a reload, and a refused start opens the review in the way. The review
 * panel never starts from here: it opens the PR with its picker, so the user confirms who runs.
 */
export function useReviewLaunch({
  repository,
  restore,
  onAskPanel,
  onError,
}: {
  repository: string
  restore: boolean
  onAskPanel: (url: string) => void
  onError: (error: string) => void
}) {
  const pending = useRef(false)
  const [starting, setStarting] = useState<string>()
  const [launched, setLaunched] = useState<{ repository: string; id: string }>()
  const restored = useRestoredLinus(repository, restore)

  async function start(companion: ReviewCompanion, url: string) {
    if (companion === 'panel') {
      onAskPanel(url)
      return
    }
    if (pending.current) return
    pending.current = true
    setStarting(url)
    onError('')
    try {
      const session = await call(routes.startLinus, { body: { repository, urls: [url] } })
      setLaunched({ repository, id: session.id })
    } catch (cause) {
      const blocking = await blockingLinus(repository)
      if (blocking) {
        setLaunched({ repository, id: blocking.id })
        onError(blockedMessage(blocking))
      } else onError(message(cause))
    } finally {
      pending.current = false
      setStarting(undefined)
    }
  }
  return {
    start,
    starting,
    linusSession: launched ?? restored.session,
    closeLinus: () => {
      const closing = launched ?? restored.session
      if (closing) restored.dismiss(closing.id)
      setLaunched(undefined)
    },
  }
}

/** The latest Linus review of the repository while it still waits on the user, until closed. */
function useRestoredLinus(repository: string, enabled: boolean) {
  const [dismissed, setDismissed] = useState<string>()
  const latest = useApiQuery(
    routes.latestLinus,
    { query: { repository } },
    { enabled: enabled && Boolean(repository) },
  )
  const candidate = latest.data?.session
  const session =
    candidate && blocksNewReview(candidate) && candidate.id !== dismissed
      ? { repository: candidate.repository, id: candidate.id }
      : undefined
  return { session, dismiss: setDismissed }
}

async function blockingLinus(repository: string): Promise<LaunchedSession | undefined> {
  try {
    const { session } = await call(routes.latestLinus, { query: { repository } })
    return session && blocksNewReview(session) ? session : undefined
  } catch {
    // The start error is still shown, so a failed lookup only loses the shortcut to the review.
    return undefined
  }
}

function blockedMessage(session: LaunchedSession) {
  const what = session.status === 'partial' ? 'is waiting on you' : 'is still running'
  return `Linus’s review of ${reviewedPullsLabel(session.urls)} ${what}, so it is open now. Finish or cancel it before starting another.`
}
