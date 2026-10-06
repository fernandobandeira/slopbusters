import { z } from 'zod'
import { agentSessionSchema, agentRunSchema, agentEventSchema } from '../domain/agentSession'
import { defineRoute, idParams, repositoryQuery } from './contract'

export const listAgentSessions = defineRoute('GET', '/agent-sessions', {
  query: repositoryQuery.partial(),
  response: z.object({
    sessions: z.array(agentSessionSchema.extend({ runs: z.array(agentRunSchema) })),
  }),
})
export const getAgentSession = defineRoute('GET', '/agent-sessions/:id', {
  params: idParams,
  response: agentSessionSchema.extend({ runs: z.array(agentRunSchema) }),
})
export const getAgentRunEvents = defineRoute('GET', '/agent-sessions/:id/runs/:runId', {
  params: idParams.extend({ runId: z.string().min(1).max(100) }),
  query: z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
  response: z.object({
    run: agentRunSchema,
    events: z.array(agentEventSchema),
    cursor: z.number().int(),
    more: z.boolean(),
  }),
})
