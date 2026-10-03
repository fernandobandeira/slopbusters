import { useEffect, useState } from 'react'
import type { PullRequest } from '../shared/types'
import type { PullStackResult } from '../shared/stacks'
import { api } from './api'

export function usePullStack(pull: PullRequest) {
  const [result, setResult] = useState<{ revision: string; data: PullStackResult }>()
  useEffect(() => {
    const controller = new AbortController()
    void api<PullStackResult>(`/stack?${new URLSearchParams({ url: pull.url })}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ revision: pull.id, data })
      })
      .catch(() => {
        // Stack metadata must not block opening a diff; Reload retries the lookup.
      })
    return () => controller.abort()
  }, [pull])
  const data = result?.revision === pull.id ? result.data : undefined
  return { stack: data?.stack, summary: data?.stack ?? data?.summary }
}
