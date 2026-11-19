import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import * as routes from '../../../shared/api'
import type { PanelSession } from '../../../shared/domain/panelSession'
import { call, message } from '../../lib/api'

interface PanelRevision {
  id: string
  revision: number
}

/** A saved panel review, polled while it runs, with the actions that move it along. */
export function usePanelSession(sessionId: string) {
  const [session, setSession] = useState<PanelSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const saved = useRef<PanelRevision>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    void call(
      routes.getPanel,
      { params: { id: sessionId }, query: {} },
      { signal: controller.signal },
    )
      .then((next) => {
        if (controller.signal.aborted) return
        saved.current = { id: sessionId, revision: next.revision }
        setSession(next.session ?? undefined)
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
  const runningId =
    session?.id === sessionId && session.status === 'running' ? sessionId : undefined
  usePanelPolling(runningId, { saved, setSession, setError })

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
    /** Show a session the server returned after another change. */
    replace: setSession,
    reload: () => {
      setRefresh((value) => value + 1)
    },
  }
}

function usePanelPolling(
  runningId: string | undefined,
  options: {
    saved: RefObject<PanelRevision | undefined>
    setSession: Dispatch<SetStateAction<PanelSession | undefined>>
    setError: (error: string) => void
  },
) {
  const { saved, setSession, setError } = options
  useEffect(() => {
    if (!runningId) return
    const id = runningId
    const controller = new AbortController()
    let timer = setTimeout(() => void poll(), 1500)
    async function poll() {
      try {
        const next = await call(
          routes.getPanel,
          {
            params: { id },
            query: { after: saved.current?.id === id ? saved.current.revision : undefined },
          },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        saved.current = { id, revision: next.revision }
        if (next.session) setSession(next.session)
        setError('')
        if (!next.session || next.session.status === 'running')
          timer = setTimeout(() => void poll(), 1500)
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(message(cause))
        timer = setTimeout(() => void poll(), 4000)
      }
    }
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [runningId, saved, setSession, setError])
}
