import { Router } from 'express'
import * as routes from '../../shared/api/agentSessions'
import { handle } from './contractRouter'
import type { Services } from '../services'

export function agentSessionsRouter({ agentSessions }: Services) {
  const router = Router()
  handle(router, routes.listAgentSessions, ({ query }) => ({
    sessions: agentSessions.store.list(query.repository),
  }))
  handle(router, routes.getAgentSession, ({ params }) => agentSessions.store.getSession(params.id))
  handle(router, routes.getAgentRunEvents, ({ params, query }) =>
    agentSessions.store.events(params.id, params.runId, query.after),
  )
  return router
}
