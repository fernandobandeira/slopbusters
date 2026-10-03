import { useEffect, useState } from 'react'
import type { PullStatus } from '../shared/pullStatus'
import { api, message } from './api'
import { watchPullUpdates } from './pullUpdates'

export function usePullStatus(url: string | undefined, snapshotId?: string) {
  const key = `${url ?? ''}@${snapshotId ?? ''}`
  const [result, setResult] = useState<{ key: string; status?: PullStatus; error?: string }>()
  useEffect(() => {
    if (!url) return
    const endpoint = snapshotId
      ? `/pulls/${encodeURIComponent(snapshotId)}/status`
      : `/pull-status?${new URLSearchParams({ url })}`
    const watcher = watchPullUpdates<PullStatus>({
      getRevision: (signal) => api<PullStatus>(endpoint, { signal }),
      onRevision: (status) => setResult({ key, status }),
      onError: (cause) =>
        setResult((previous) => ({
          ...(previous?.key === key ? previous : {}),
          key,
          error: message(cause),
        })),
      isVisible: () => document.visibilityState === 'visible',
    })
    const wake = () => {
      if (document.visibilityState === 'visible') watcher.check()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      watcher.stop()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
  }, [url, snapshotId, key])
  const current = result?.key === key ? result : undefined
  return { status: current?.status, error: current?.error, loading: Boolean(url && !current) }
}
