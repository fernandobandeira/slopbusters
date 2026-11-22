import { buildStackBrief } from '../../../shared/domain/projectStackBrief'
import { useStackRecords } from './useStackRecords'
import { useEffect, useMemo, useState } from 'react'
import * as routes from '../../../shared/api'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { StackReviewSession } from '../../../shared/domain/stackReview'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'

const POLL_MS = 2000

/** The newest stack review covering a PR, polled while it runs, with the actions that move it. */
export function useStackReview(url: string) {
  const { owner, repo } = parsePullUrl(url)
  const latest = useApiQuery(routes.latestStackReview, {
    query: { repository: `${owner}/${repo}`, url },
  })
  const [started, setStarted] = useState<StackReviewSession>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [startError, setStartError] = useState('')
  const session = started ?? latest.data?.session ?? undefined
  useStackReviewPolling(session, setStarted)
  const records = useStackRecords(session?.id ?? '', session?.status === 'complete')

  const brief = useMemo(
    () => session && buildStackBrief(session, records.data)?.projected,
    [session, records.data],
  )

  async function act(run: () => Promise<StackReviewSession>, reportError = setError) {
    if (busy) return false
    setBusy(true)
    setError('')
    setStartError('')
    try {
      setStarted(await run())
      return true
    } catch (cause) {
      reportError(message(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  return {
    session,
    brief,
    records,
    loading: latest.loading,
    busy,
    startError,
    error: error || records.error || latest.error,
    start: (reviewers: PanelSeatRequest[]) =>
      act(() => call(routes.startStackReview, { body: { url, reviewers } }), setStartError),
    retry: (id: string) => act(() => call(routes.retryStackReview, { params: { id } })),
    cancel: (id: string) => act(() => call(routes.cancelStackReview, { params: { id } })),
  }
}

function useStackReviewPolling(
  session: StackReviewSession | undefined,
  update: (session: StackReviewSession) => void,
) {
  const runningId = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!runningId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await call(
          routes.getStackReview,
          { params: { id: runningId } },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        update(next)
        if (next.status === 'running') timer = setTimeout(() => void poll(), POLL_MS)
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), POLL_MS * 2)
      }
    }
    timer = setTimeout(() => void poll(), POLL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [runningId, update])
}
