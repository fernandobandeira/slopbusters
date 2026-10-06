import { z } from 'zod'
import { organizationSchema } from './preferences'

export const gandalfTurnSchema = z.object({
  summary: z.string().min(1).max(4000),
  approved: z.boolean(),
  issues: z.array(z.string().max(2000)).max(30),
  edits: z.array(z.object({ path: z.string().min(1), content: z.string().nullable() })).max(100),
})
export type GandalfTurn = z.infer<typeof gandalfTurnSchema>

export const gandalfSessionSchema = z.object({
  id: z.string(),
  repository: z.string(),
  urls: z.array(z.string()),
  primary: organizationSchema,
  companion: organizationSchema,
  status: z.enum(['running', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  createdAt: z.string(),
  error: z.string().optional(),
  turns: z.array(
    z.object({
      url: z.string(),
      role: z.enum(['primary', 'secondary']),
      round: z.number().int(),
      summary: z.string(),
      issues: z.array(z.string()),
      approved: z.boolean(),
      changedPaths: z.array(z.string()),
      revision: z.string(),
    }),
  ),
  results: z.array(
    z.object({
      url: z.string(),
      number: z.number().int(),
      title: z.string(),
      headSha: z.string(),
      baseSha: z.string(),
      resolvedSha: z.string(),
      changedPaths: z.array(z.string()),
      rounds: z.number().int(),
      published: z.boolean(),
    }),
  ),
})
export type GandalfSession = z.infer<typeof gandalfSessionSchema>
