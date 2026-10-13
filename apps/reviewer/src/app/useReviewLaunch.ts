import { useRef, useState } from 'react'
import * as routes from '../../shared/api'
import {
  blocksNewReview,
  reviewedPullsLabel,
  type ReviewSession,
} from '../../shared/domain/reviewSession'
import type { ReviewCompanion } from '../components/StartReviewButton'
import { call, message } from '../lib/api'
import { useApiQuery } from '../lib/useApiQuery'

type LaunchedSession = Pick<ReviewSession<unknown>, 'id' | 'urls' | 'status' | 'results'>

const companionNames: Record<ReviewCompanion, string> = { bob: 'Uncle Bob', linus: 'Linus' }

/**
 * Starts persona reviews and keeps the review that blocks a new one reachable: a running or
 * partial Linus review reopens after a reload, and a refused start opens the review in the way.
 */
export function useReviewLaunch({
  repository,
  restore,
  onBobOpen,
  onError,
}: {
  repository: string
  restore: boolean
  onBobOpen: (url: string, sessionId: string) => void
  onError: (error: string) => void
}) {
  const pending = useRef(false)
  const [starting, setStarting] = useState<string>()
  const [launched, setLaunched] = useState<{ repository: string; id: string }>()
  const restored = useRestoredLinus(repository, restore)

  async function start(companion: ReviewCompanion, url: string) {
    if (pending.current) return
    pending.current = true
    setStarting(url)
    onError('')
    try {
      const session = await startSession(companion, repository, url)
      open(companion, session.id, url)
    } catch (cause) {
      const blocking = await blockingSession(companion, repository)
      if (blocking) {
        open(companion, blocking.id, reviewedUrl(blocking))
        onError(blockedMessage(companion, blocking))
      } else onError(message(cause))
    } finally {
      pending.current = false
      setStarting(undefined)
    }
  }
  function open(companion: ReviewCompanion, id: string, url: string) {
    if (companion === 'linus') setLaunched({ repository, id })
    else onBobOpen(url, id)
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

function startSession(
  companion: ReviewCompanion,
  repository: string,
  url: string,
): Promise<LaunchedSession> {
  const input = { body: { repository, urls: [url] } }
  return companion === 'bob' ? call(routes.startBob, input) : call(routes.startLinus, input)
}

async function blockingSession(
  companion: ReviewCompanion,
  repository: string,
): Promise<LaunchedSession | undefined> {
  const input = { query: { repository } }
  try {
    const { session } =
      companion === 'bob'
        ? await call(routes.latestBob, input)
        : await call(routes.latestLinus, input)
    return session && blocksNewReview(session) ? session : undefined
  } catch {
    // The start error is still shown, so a failed lookup only loses the shortcut to the review.
    return undefined
  }
}

function blockedMessage(companion: ReviewCompanion, session: LaunchedSession) {
  const name = companionNames[companion]
  const what = session.status === 'partial' ? 'is waiting on you' : 'is still running'
  return `${name}’s review of ${reviewedPullsLabel(session.urls)} ${what}, so it is open now. Finish or cancel it before starting another.`
}

/** The PR a Bob companion should open on: the one under review, or the first. */
function reviewedUrl(session: LaunchedSession) {
  return session.urls[session.results.length] ?? session.urls[0] ?? ''
}
