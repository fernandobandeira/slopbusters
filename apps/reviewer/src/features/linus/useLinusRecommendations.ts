import * as routes from '../../../shared/api'
import { useEffect, useState } from 'react'
import type { LinusRecommendation } from '../../../shared/domain/linus'
import { call, message } from '../../lib/api'

export function useLinusRecommendations(repository: string, refresh: number) {
  const [saved, setSaved] = useState<{
    repository: string
    recommendations: LinusRecommendation[]
    error?: string
  }>()
  useEffect(() => {
    if (!repository) return
    const controller = new AbortController()
    void call(
      routes.linusRecommendations,
      { query: { ...{ repository } } },
      { signal: controller.signal },
    )
      .then(({ recommendations }) => {
        if (!controller.signal.aborted) setSaved({ repository, recommendations })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSaved({ repository, recommendations: [], error: message(cause) })
      })
    return () => {
      controller.abort()
    }
  }, [repository, refresh])
  return saved?.repository === repository ? saved : { recommendations: [], error: undefined }
}
