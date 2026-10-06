import { useRef, useState } from 'react'
import * as routes from '../../shared/api'
import type { ReviewCompanion } from '../components/StartReviewButton'
import { call, message } from '../lib/api'

export function useReviewLaunch({
  repository,
  onBobOpen,
  onError,
}: {
  repository: string
  onBobOpen: (url: string, sessionId: string) => void
  onError: (error: string) => void
}) {
  const pending = useRef(false)
  const [starting, setStarting] = useState<string>()
  const [linusSession, setLinusSession] = useState<{ repository: string; id: string }>()

  async function start(companion: ReviewCompanion, url: string) {
    if (pending.current) return
    pending.current = true
    setStarting(url)
    onError('')
    try {
      const input = { body: { repository, urls: [url] } }
      if (companion === 'bob') {
        const session = await call(routes.startBob, input)
        onBobOpen(url, session.id)
      } else {
        const session = await call(routes.startLinus, input)
        setLinusSession({ repository, id: session.id })
      }
    } catch (cause) {
      onError(message(cause))
    } finally {
      pending.current = false
      setStarting(undefined)
    }
  }
  return {
    start,
    starting,
    linusSession,
    closeLinus: () => {
      setLinusSession(undefined)
    },
  }
}
