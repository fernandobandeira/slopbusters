import { useEffect, useState } from 'react'
import * as routes from '../../../shared/api'
import type { GandalfSession, GandalfTask } from '../../../shared/domain/gandalf'
import { useApiQuery } from '../../lib/useApiQuery'
import { call, message } from '../../lib/api'

export function useGandalfSession(repository: string, task: GandalfTask, onComplete: () => void) {
  const [session, setSession] = useState<GandalfSession>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useApiQuery(routes.latestGandalf, { query: { repository } })
  const current = session ?? latest.data?.session ?? undefined
  const runningId = current?.status === 'running' ? current.id : undefined
  useEffect(() => {
    if (!runningId) return
    const id = runningId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(
          routes.getGandalf,
          { params: { id } },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setSession(next)
        setError('')
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500)
        else onComplete()
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
  }, [runningId, onComplete])

  async function act(action: 'start' | 'retry' | 'cancel', urls: string[] = []) {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      const params = { id: current?.id ?? '' }
      const next =
        action === 'start'
          ? await call(routes.startGandalf, { body: { repository, urls, task } })
          : action === 'retry'
            ? await call(routes.retryGandalf, { params })
            : await call(routes.cancelGandalf, { params })
      setSession(next)
      if (action === 'cancel') onComplete()
      return true
    } catch (cause) {
      setError(message(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  return {
    session: current,
    busy,
    loading: latest.loading,
    error: error || latest.error,
    act,
    reload: latest.reload,
  }
}
