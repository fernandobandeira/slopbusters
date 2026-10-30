import * as routes from '../../../shared/api'
import { useEffect, useState } from 'react'
import type { LinusSession, LinusThenPanel } from '../../../shared/domain/linus'
import { call, message } from '../../lib/api'

export function useLinusSession(repository: string, sessionId?: string) {
  const [activeId, setActiveId] = useState(sessionId)
  const [session, setSession] = useState<LinusSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!repository) return
    const controller = new AbortController()
    const options = { signal: controller.signal }
    const request = activeId
      ? call(routes.getLinus, { params: { id: activeId } }, options).then((session) => ({
          session,
        }))
      : call(routes.latestLinus, { query: { repository } }, options)
    void request
      .then((result) => {
        if (!controller.signal.aborted) {
          setSession(result.session ?? undefined)
          setLoading(false)
          setError('')
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(message(cause))
          setLoading(false)
        }
      })
    return () => {
      controller.abort()
    }
  }, [repository, refresh, activeId])
  const runningId = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!runningId) return
    const id = runningId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(routes.getLinus, { params: { id } }, { signal: controller.signal })
        if (controller.signal.aborted) return
        setSession(next)
        setError('')
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500)
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(message(cause))
        timer = setTimeout(() => void poll(), 4000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [runningId])

  /** Run one request on the review while the companion shows it as busy. */
  async function run(request: () => Promise<LinusSession>): Promise<LinusSession | undefined> {
    if (busy) return undefined
    setBusy(true)
    setError('')
    try {
      return await request()
    } catch (cause) {
      setError(message(cause))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  async function act(action: 'retry' | 'continue' | 'cancel') {
    const params = { id: session?.id ?? '' }
    const next = await run(() =>
      action === 'cancel'
        ? call(routes.cancelLinus, { params })
        : action === 'retry'
          ? call(routes.retryLinus, { params })
          : call(routes.continueLinus, { params }),
    )
    if (next) {
      setSession(next)
      setActiveId(next.id)
    }
  }
  /** Send a reviewed PR on to the panel that was to follow Linus, whatever he said. */
  async function sendToPanel(id: string, url: string): Promise<LinusSession | undefined> {
    const next = await run(() => call(routes.startLinusPanel, { params: { id }, body: { url } }))
    if (next && next.id === session?.id) setSession(next)
    return next
  }
  /** Ask Linus about the PR again with the author's guidance; the same panel follows. */
  async function askAgain(
    url: string,
    guidance: string,
    thenPanel?: LinusThenPanel,
  ): Promise<LinusSession | undefined> {
    const next = await run(() =>
      call(routes.startLinus, {
        body: { repository, urls: [url], guidance, ...(thenPanel ? { thenPanel } : {}) },
      }),
    )
    if (next) {
      setSession(next)
      setActiveId(next.id)
    }
    return next
  }
  return {
    session,
    loading,
    busy,
    error,
    act,
    sendToPanel,
    askAgain,
    reload: () => {
      setRefresh((value) => value + 1)
    },
  }
}
