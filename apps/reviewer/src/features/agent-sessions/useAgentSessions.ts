import { useEffect } from 'react'
import * as routes from '../../../shared/api/agentSessions'
import { useApiQuery } from '../../lib/useApiQuery'

export function useAgentSessions(repository?: string) {
  const query = useApiQuery(routes.listAgentSessions, {
    query: { repository: repository || undefined },
  })
  const { reload } = query
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) reload()
    }, 1500)
    return () => {
      clearInterval(timer)
    }
  }, [reload])
  return query
}
