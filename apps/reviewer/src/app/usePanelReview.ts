import { useLocation, useNavigate } from 'react-router'
import * as routes from '../../shared/api'
import { useApiQuery } from '../lib/useApiQuery'

/**
 * The review panel: each PR's latest saved result, and the open panel session, kept in the
 * `panel` query parameter so a reload reopens it. Opening a panel closes Uncle Bob's companion.
 */
export function usePanelReview({
  repository,
  enabled,
  refresh,
}: {
  repository: string
  enabled: boolean
  refresh: number
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const saved = useApiQuery(
    routes.savedPanelReviews,
    { query: { repository } },
    { enabled, refresh },
  )
  const query = new URLSearchParams(location.search)
  function go(next: URLSearchParams, replace = false) {
    void navigate(`${location.pathname}?${next.toString()}`, { replace })
  }
  return {
    reviewFor: (url: string) => saved.data?.reviews.find((review) => review.url === url),
    error: saved.error,
    sessionId: query.get('panel') ?? undefined,
    reload: saved.reload,
    open: (sessionId: string) => {
      const next = new URLSearchParams(location.search)
      next.delete('bob')
      next.set('panel', sessionId)
      go(next)
    },
    close: () => {
      const next = new URLSearchParams(location.search)
      next.delete('panel')
      go(next, true)
    },
  }
}
