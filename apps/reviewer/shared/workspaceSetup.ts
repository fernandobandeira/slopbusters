import { z } from 'zod'
import { DiffSide, Provider } from './types'

export const setupCommandSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[^\s\0]+$/),
    args: z.array(z.string().max(4000)).max(50),
    directory: z.string().min(1).max(2000),
    reason: z.string().min(1).max(2000),
  })
  .strict()
export const setupPlanSchema = z
  .object({
    explanation: z.string().min(1).max(8000),
    commands: z.array(setupCommandSchema).max(12),
  })
  .strict()
export const setupRequestSchema = z
  .object({
    side: z.enum(DiffSide),
    provider: z.enum(Provider),
    path: z.string().min(1).max(2000),
    warnings: z.array(z.string().max(4000)).max(30),
  })
  .strict()
export const workspaceSetupSchema = z.object({
  id: z.string(),
  pullId: z.string(),
  owner: z.string(),
  repo: z.string(),
  sha: z.string(),
  provider: z.enum(Provider),
  status: z.enum(['planning', 'awaiting-approval', 'running', 'ready', 'failed', 'cancelled']),
  plan: setupPlanSchema.optional(),
  directory: z.string().optional(),
  log: z.string(),
  error: z.string().optional(),
})
export type SetupCommand = z.infer<typeof setupCommandSchema>
export type SetupPlan = z.infer<typeof setupPlanSchema>
export type SetupRequest = z.infer<typeof setupRequestSchema>
export type WorkspaceSetup = z.infer<typeof workspaceSetupSchema>
