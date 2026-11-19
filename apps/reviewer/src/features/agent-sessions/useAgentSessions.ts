import { useEffect } from 'react'
import * as routes from '../../../shared/api/agentSessions'
import { useApiQuery } from '../../lib/useApiQuery'

export function useAgentSessions(repository?: string) {
  const query = useApiQuery(routes.listAgentSessions, {
    query: { repository: repository || undefined },
  })
  useSessionRefresh(query.reload, 1500)
  return query
}

export function useAgentSession(id: string, interval: number) {
  const query = useApiQuery(routes.getAgentSession, { params: { id } })
  useSessionRefresh(query.reload, interval)
  return query
}

function useSessionRefresh(reload: () => void, interval: number) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) reload()
    }, interval)
    return () => {
      clearInterval(timer)
    }
  }, [reload, interval])
}
