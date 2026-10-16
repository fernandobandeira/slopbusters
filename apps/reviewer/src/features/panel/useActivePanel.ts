import { useEffect, useEffectEvent } from 'react'
import * as routes from '../../../shared/api'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import { useApiQuery } from '../../lib/useApiQuery'

const POLL_MS = 2500

/**
 * The panel still working on this PR, running or waiting on the user, so leaving the PR and
 * coming back finds it again. Polls while it runs and calls `onSettled` once it stops.
 */
export function useActivePanel({
  repository,
  url,
  onSettled,
}: {
  repository: string
  url: string
  onSettled?: () => void
}) {
  const latest = useApiQuery(routes.latestPanel, { query: { repository, url } })
  const session = latest.data?.session ?? undefined
  const running = session?.status === 'running'
  const { reload } = latest
  const settled = useEffectEvent(() => onSettled?.())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(reload, POLL_MS)
    return () => {
      clearInterval(timer)
      settled()
    }
  }, [running, reload])
  return {
    session: session && blocksNewReview(session) ? session : undefined,
    loading: latest.loading,
    reload,
  }
}
