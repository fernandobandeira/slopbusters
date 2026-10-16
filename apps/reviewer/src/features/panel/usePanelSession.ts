import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import * as routes from '../../../shared/api'
import type { PanelSession } from '../../../shared/domain/panel'
import { call, message } from '../../lib/api'

/** A saved panel review, polled while it runs, with the actions that move it along. */
export function usePanelSession(sessionId: string) {
  const [session, setSession] = useState<PanelSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void call(routes.getPanel, { params: { id: sessionId } }, { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return
        setSession(next)
        setLoading(false)
        setError('')
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(message(cause))
        setLoading(false)
      })
    return () => {
      controller.abort()
    }
  }, [sessionId, refresh])
  usePanelPolling(session, { setSession, setError })

  async function act(action: 'retry' | 'continue' | 'cancel') {
    if (busy || !session) return
    setBusy(true)
    setError('')
    try {
      const params = { id: session.id }
      setSession(
        action === 'cancel'
          ? await call(routes.cancelPanel, { params })
          : action === 'retry'
            ? await call(routes.retryPanel, { params })
            : await call(routes.continuePanel, { params }),
      )
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return {
    session,
    loading,
    busy,
    error,
    act,
    reload: () => {
      setRefresh((value) => value + 1)
    },
  }
}

function usePanelPolling(
  session: PanelSession | undefined,
  options: {
    setSession: Dispatch<SetStateAction<PanelSession | undefined>>
    setError: (error: string) => void
  },
) {
  const { setSession, setError } = options
  const runningId = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!runningId) return
    const id = runningId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(routes.getPanel, { params: { id } }, { signal: controller.signal })
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
  }, [runningId, setSession, setError])
}
