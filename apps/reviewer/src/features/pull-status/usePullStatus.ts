import { onBrowserWake } from '../../lib/browserWake'
import * as routes from '../../../shared/api'
import { useCallback, useEffect, useState } from 'react'
import type { PullStatus } from '../../../shared/domain/pullStatus'
import { call, message } from '../../lib/api'
import { watchPullUpdates } from './pullUpdates'

export function usePullStatus(url: string | undefined, snapshotId?: string) {
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => {
    setRefreshCount((previous) => previous + 1)
  }, [])
  const key = `${url ?? ''}@${snapshotId ?? ''}@${refreshCount}`
  const [result, setResult] = useState<{ key: string; status?: PullStatus; error?: string }>()
  useEffect(() => {
    if (!url) return
    const watcher = watchPullUpdates<PullStatus>({
      getRevision: (signal) =>
        snapshotId
          ? call(routes.getPullStatus, { params: { id: snapshotId } }, { signal })
          : call(routes.getStatusByUrl, { query: { url } }, { signal }),
      onRevision: (status) => {
        setResult({ key, status })
      },
      onError: (cause) => {
        setResult((previous) => ({
          ...(previous?.key === key ? previous : {}),
          key,
          error: message(cause),
        }))
      },
      isVisible: () => document.visibilityState === 'visible',
    })
    const stopListening = onBrowserWake(() => {
      watcher.check()
    })
    return () => {
      watcher.stop()
      stopListening()
    }
  }, [url, snapshotId, key])
  const current = result?.key === key ? result : undefined
  return {
    status: current?.status,
    error: current?.error,
    loading: Boolean(url && !current),
    refresh,
  }
}
