import { useEffect, useState } from 'react'
import type { PullRequest } from '../shared/types'
import { pullHasUpdates, type PullRevision } from '../shared/updates'
import { api, message } from './api'
import { watchPullUpdates } from './pullUpdates'

export function usePullUpdates(pull: PullRequest) {
  const [result, setResult] = useState<{
    key: string
    revision?: PullRevision
    error?: string
  }>()
  useEffect(() => {
    const watcher = watchPullUpdates({
      getRevision: (signal) => api<PullRevision>(`/pulls/${pull.id}/revision`, { signal }),
      onRevision: (revision) => setResult({ key: pull.id, revision }),
      onError: (error) =>
        setResult((previous) => ({
          ...(previous?.key === pull.id ? previous : {}),
          key: pull.id,
          error: message(error),
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
  }, [pull.id])

  const current = result?.key === pull.id ? result : undefined
  return {
    hasUpdates: Boolean(current?.revision && pullHasUpdates(pull, current.revision)),
    latest: current?.revision,
    error: current?.error,
  }
}
