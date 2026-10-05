import { onBrowserWake } from '../../lib/browserWake'
import * as routes from '../../../shared/api'
import { useEffect, useState } from 'react'
import type { PullRequest } from '../../../shared/domain/types'
import { pullHasUpdates, type PullRevision } from '../../../shared/domain/updates'
import { call, message } from '../../lib/api'
import { watchPullUpdates } from './pullUpdates'

export function usePullUpdates(pull: PullRequest) {
  const [result, setResult] = useState<{
    key: string
    revision?: PullRevision
    error?: string
  }>()
  useEffect(() => {
    const watcher = watchPullUpdates({
      getRevision: (signal) =>
        call(routes.getPullRevision, { params: { id: pull.id } }, { signal }),
      onRevision: (revision) => {
        setResult({ key: pull.id, revision })
      },
      onError: (error) => {
        setResult((previous) => ({
          ...(previous?.key === pull.id ? previous : {}),
          key: pull.id,
          error: message(error),
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
  }, [pull.id])

  const current = result?.key === pull.id ? result : undefined
  return {
    hasUpdates: Boolean(current?.revision && pullHasUpdates(pull, current.revision)),
    latest: current?.revision,
    error: current?.error,
  }
}
