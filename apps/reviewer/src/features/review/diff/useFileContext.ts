import * as routes from '../../../../shared/api'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PullFileContent } from '../../../../shared/domain/fileContent'
import { call, message } from '../../../lib/api'

export function useFileContext(pullId: string) {
  const [cache, setCache] = useState(new Map<string, PullFileContent>())
  const [loading, setLoading] = useState(new Set<string>())
  const [errors, setErrors] = useState(new Map<string, string>())
  const pending = useRef(new Map<string, Promise<PullFileContent>>())
  const prefix = `${pullId}/`
  const contents = useMemo(
    () =>
      new Map(
        [...cache]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      ),
    [cache, prefix],
  )
  const load = useCallback(
    (fileId: string): Promise<PullFileContent> => {
      const key = `${pullId}/${fileId}`
      const cached = cache.get(key)
      if (cached) return Promise.resolve(cached)
      const existing = pending.current.get(key)
      if (existing) return existing
      setLoading((values) => new Set(values).add(key))
      setErrors((values) => {
        const next = new Map(values)
        next.delete(key)
        return next
      })
      const request = call(routes.getFileContent, { params: { id: pullId, fileId: fileId } })
        .then((content) => {
          setCache((values) => new Map(values).set(key, content))
          return content
        })
        .catch((error: unknown) => {
          setErrors((values) => new Map(values).set(key, message(error)))
          throw error
        })
        .finally(() => {
          pending.current.delete(key)
          setLoading((values) => {
            const next = new Set(values)
            next.delete(key)
            return next
          })
        })
      pending.current.set(key, request)
      return request
    },
    [pullId, cache],
  )
  return {
    contents,
    load,
    isLoading: (fileId: string) => loading.has(`${pullId}/${fileId}`),
    error: (fileId: string) => errors.get(`${pullId}/${fileId}`),
  }
}
