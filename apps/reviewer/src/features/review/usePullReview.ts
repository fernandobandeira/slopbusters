import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router'
import type { PullRequest } from '../../../shared/domain/types'
import * as routes from '../../../shared/api'
import { call, message } from '../../lib/api'
import { readRoute, routeMatchesPull, type AppRoute } from '../../lib/routes'

export function usePullReview(
  route: AppRoute,
  pathname: string,
  navigate: NavigateFunction,
  setError: (message: string) => void,
) {
  const [pullResult, setPullResult] = useState<{
    key: string
    pull?: PullRequest
    error?: string
  }>()
  const pullCache = useRef(new Map<string, PullRequest>())
  const [reloading, setReloading] = useState(false)
  const pullUrl =
    route.kind === 'pull' ? `https://github.com/${route.repository}/pull/${route.number}` : ''
  const revision = route.kind === 'pull' ? route.revision : undefined
  const pullKey = pullUrl ? `${pullUrl}@${revision ?? 'latest'}` : ''
  const pull = pullResult?.key === pullKey ? pullResult.pull : undefined
  const loading = Boolean(pullKey && pullResult?.key !== pullKey)
  useEffect(() => {
    if (!pullUrl) return
    const controller = new AbortController()
    const fromGitHub = () =>
      call(routes.loadPull, { body: { url: pullUrl } }, { signal: controller.signal })
    const cached = revision ? pullCache.current.get(pullKey) : undefined
    let load: Promise<PullRequest>
    if (cached) load = Promise.resolve(cached)
    else if (revision) {
      load = call(routes.getPull, { params: { id: revision } }, { signal: controller.signal })
        .then((pr) => {
          if (
            !routeMatchesPull(
              readRoute({ pathname: window.location.pathname, search: window.location.search }),
              pr,
            )
          )
            throw new Error('This snapshot belongs to another PR.')
          return pr
        })
        .catch((error) => {
          if (controller.signal.aborted) throw error
          return fromGitHub()
        })
    } else load = fromGitHub()
    void load
      .then((pr) => {
        if (controller.signal.aborted) return
        pullCache.current.set(pullKey, pr)
        pullCache.current.set(`${pullUrl}@${pr.id}`, pr)
        setPullResult({ key: pullKey, pull: pr })
        if (revision !== pr.id) {
          const search = new URLSearchParams(window.location.search)
          search.set('revision', pr.id)
          void navigate(
            { pathname: window.location.pathname, search: `?${search}` },
            { replace: true },
          )
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPullResult({ key: pullKey, error: message(error) })
      })
    return () => {
      controller.abort()
    }
  }, [pullUrl, revision, pullKey, navigate])

  const updatePull = useCallback(
    (pr: PullRequest) => {
      pullCache.current.set(pullKey, pr)
      setPullResult({ key: pullKey, pull: pr })
    },
    [pullKey],
  )

  async function reloadPull() {
    if (!pull) return
    const stillViewingSnapshot = () => {
      const current = readRoute({
        pathname: window.location.pathname,
        search: window.location.search,
      })
      return (
        current.kind === 'pull' && routeMatchesPull(current, pull) && current.revision === revision
      )
    }
    setReloading(true)
    setError('')
    try {
      const pr = await call(routes.loadPull, { body: { url: pull.url } })
      pullCache.current.set(`${pr.url}@${pr.id}`, pr)
      if (!stillViewingSnapshot()) return
      if (pr.id === pull.id) updatePull(pr)
      else {
        const search = new URLSearchParams(window.location.search)
        search.set('revision', pr.id)
        search.delete('group')
        search.delete('file')
        void navigate({ pathname, search: `?${search}` }, { replace: true })
      }
    } catch (error) {
      if (stillViewingSnapshot()) setError(message(error))
    } finally {
      setReloading(false)
    }
  }

  return {
    pull,
    loading,
    pullError: pullResult?.key === pullKey ? pullResult.error : undefined,
    updatePull,
    reloadPull,
    reloading,
  }
}
