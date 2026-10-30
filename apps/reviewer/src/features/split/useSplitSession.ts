import { useEffect, useState } from 'react'
import * as routes from '../../../shared/api'
import type { SplitSession } from '../../../shared/domain/split'
import { call, message } from '../../lib/api'

/** One split, followed while it runs; `onSettled` fires when it stops, so the PR list refreshes. */
export function useSplitSession(id: string, onSettled: () => void) {
  const [session, setSession] = useState<SplitSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(routes.getSplit, { params: { id } }, { signal: controller.signal })
        if (controller.signal.aborted) return
        setSession(next)
        setLoading(false)
        setError('')
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500)
        else onSettled()
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(message(cause))
        setLoading(false)
        timer = setTimeout(() => void poll(), 4000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // The settle callback is read when the split stops, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refresh])

  async function act(action: 'cancel' | 'retry') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const params = { id }
      setSession(
        action === 'cancel'
          ? await call(routes.cancelSplit, { params })
          : await call(routes.retrySplit, { params }),
      )
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return { session, loading, busy, error, act }
}
