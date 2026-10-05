import * as routes from '../../../shared/api'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { BobSession } from '../../../shared/domain/bob'
import { call, message } from '../../lib/api'

export function useBobSession(repository: string, url: string) {
  const [session, setSession] = useState<BobSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!repository) return
    const controller = new AbortController()
    void call(routes.latestBob, { query: { repository, url } }, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setSession(result.session ?? undefined)
          setLoading(false)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(message(cause))
          setLoading(false)
        }
      })
    return () => {
      controller.abort()
    }
  }, [repository, url, refresh])
  useBobPolling(session, { setSession, setError })

  async function act(action: 'start' | 'retry' | 'continue' | 'cancel', urls?: string[]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const params = { id: session?.id ?? '' }
      const next =
        action === 'start'
          ? await call(routes.startBob, { body: { repository, urls: urls ?? [] } })
          : action === 'cancel'
            ? await call(routes.cancelBob, { params })
            : action === 'retry'
              ? await call(routes.retryBob, { params })
              : await call(routes.continueBob, { params })
      setSession(next)
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

function useBobPolling(
  session: BobSession | undefined,
  options: {
    setSession: Dispatch<SetStateAction<BobSession | undefined>>
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
        const next = await call(routes.getBob, { params: { id } }, { signal: controller.signal })
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
