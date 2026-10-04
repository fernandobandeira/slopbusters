import { useEffect, useState } from 'react'
import type { LinusSession } from '../shared/linus'
import { api, message } from './api'

export function useLinusSession(repository: string) {
  const [session, setSession] = useState<LinusSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!repository) return
    const controller = new AbortController()
    void api<{ session: LinusSession | null }>(
      `/linus/latest?${new URLSearchParams({ repository })}`,
      { signal: controller.signal },
    )
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
    return () => controller.abort()
  }, [repository, refresh])
  const runningId = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!runningId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await api<LinusSession>(`/linus/${runningId}`, { signal: controller.signal })
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

  async function act(action: 'start' | 'retry' | 'continue' | 'cancel', urls?: string[]) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const endpoint =
        action === 'start'
          ? '/linus'
          : `/linus/${session!.id}${action === 'cancel' ? '' : `/${action}`}`
      const next = await api<LinusSession>(endpoint, {
        method: action === 'cancel' ? 'DELETE' : 'POST',
        ...(action === 'start' && { body: JSON.stringify({ repository, urls }) }),
      })
      setSession(next)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return { session, loading, busy, error, act, reload: () => setRefresh((value) => value + 1) }
}
