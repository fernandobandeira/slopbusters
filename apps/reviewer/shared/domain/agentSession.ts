import { z } from 'zod'
import { organizationSchema } from './preferences'

export const agentKindSchema = z.enum(['gandalf', 'bob', 'linus', 'grouping'])
export const agentStateSchema = z.enum(['running', 'partial', 'complete', 'failed', 'cancelled'])
export const agentEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['prompt', 'assistant', 'reasoning', 'tool', 'activity']),
  text: z.string(),
  title: z.string().optional(),
  status: z.enum(['running', 'complete', 'failed']).optional(),
  sequence: z.number().int(),
  position: z.number().int(),
})
export type AgentEvent = z.infer<typeof agentEventSchema>
export type ProviderEvent = Omit<AgentEvent, 'sequence' | 'position'>
export type ProviderObserver = (event: ProviderEvent) => void
export const agentRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  model: organizationSchema,
  label: z.string(),
  url: z.string().optional(),
  status: agentStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
})
export type AgentRun = z.infer<typeof agentRunSchema>
export const agentSessionSchema = z.object({
  id: z.string(),
  kind: agentKindSchema,
  repository: z.string(),
  urls: z.array(z.string()),
  status: agentStateSchema,
  progress: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
  failureContext: z.string().optional(),
})
export type AgentSession = z.infer<typeof agentSessionSchema>
