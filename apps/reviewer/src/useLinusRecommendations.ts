import { useEffect, useState } from 'react'
import type { LinusRecommendation } from '../shared/linus'
import { api, message } from './api'

export function useLinusRecommendations(repository: string, refresh: number) {
  const [saved, setSaved] = useState<{
    repository: string
    recommendations: LinusRecommendation[]
    error?: string
  }>()
  useEffect(() => {
    if (!repository) return
    const controller = new AbortController()
    void api<{ recommendations: LinusRecommendation[] }>(
      `/linus/recommendations?${new URLSearchParams({ repository })}`,
      { signal: controller.signal },
    )
      .then(({ recommendations }) => {
        if (!controller.signal.aborted) setSaved({ repository, recommendations })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSaved({ repository, recommendations: [], error: message(cause) })
      })
    return () => controller.abort()
  }, [repository, refresh])
  return saved?.repository === repository ? saved : { recommendations: [], error: undefined }
}
