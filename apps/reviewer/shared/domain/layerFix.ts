import { decisionProvenanceSchema } from './stackReviewRecords'
import { z } from 'zod'
import { groundingEfforts, groundingKinds } from './grounding'
import { organizationSchema } from './preferences'
import { fixCheckStatuses } from './panelFix'

export const workerFixSchema = z.object({
  id: z.string(),
  title: z.string(),
  plan: z.string().optional(),
  reason: z.string(),
  decision: decisionProvenanceSchema.optional(),
  kind: z.enum(groundingKinds).optional(),
  effort: z.enum(groundingEfforts).optional(),
  field: z.enum(['title', 'description']).optional(),
})
export const workerReportSchema = z
  .object({
    summary: z.string(),
    fixes: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(['applied', 'skipped', 'failed']),
          commits: z.array(z.string().regex(/^[a-f0-9]{40}$/)),
          note: z.string(),
        })
        .strict(),
    ),
    checks: z.array(z.object({ command: z.string().min(1), exitCode: z.number().int() }).strict()),
  })
  .strict()
export type WorkerReport = z.infer<typeof workerReportSchema>
export const observedCommandSchema = z.object({
  id: z.string(),
  input: z.string(),
  output: z.string().optional(),
  exitCode: z.number().int().optional(),
  outputIndicatesFailure: z.boolean().optional(),
})
export const layerFixSessionSchema = z.object({
  id: z.string(),
  stack: z.string(),
  urls: z.array(z.string()),
  url: z.string(),
  createdAt: z.string(),
  status: z.enum(['running', 'partial', 'complete', 'failed', 'cancelled']),
  outcome: z.enum(['done', 'needs-you', 'stopped', 'pushed', 'moved', 'interrupted']).optional(),
  progress: z.string(),
  error: z.string().optional(),
  start: z.string(),
  base: z.string(),
  fixes: z.array(workerFixSchema),
  model: organizationSchema,
  checker: organizationSchema,
  worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
  thread: z
    .object({
      threadId: z.string(),
      messageId: z.string(),
      runtimeMode: z.enum(['auto', 'full-access', 'approval-required', 'auto-accept-edits']),
    })
    .optional(),
  correctionUsed: z.boolean(),
  commands: z.array(observedCommandSchema),
  report: workerReportSchema.optional(),
  head: z.string().optional(),
  commits: z.array(z.string()),
  left: z.array(z.string()),
  results: z.array(
    z.object({
      entry: z.string(),
      status: z.enum(fixCheckStatuses),
      note: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
})
export type LayerFixSession = z.infer<typeof layerFixSessionSchema>

export const LOCAL_WORKTREE_BLOCK =
  'A previous run has a local worktree at this head. Use that worktree and review the updated pull request before starting another run.'

export function appliedLayerFixEntries(run: LayerFixSession): string[] {
  if (run.outcome === 'done') return run.fixes.filter((fix) => !fix.field).map(({ id }) => id)
  return run.results
    .filter(
      (item) =>
        item.status === 'applied' &&
        run.report?.fixes.some(
          (fix) =>
            fix.id === item.entry &&
            fix.status === 'applied' &&
            fix.commits.length > 0 &&
            fix.commits.every((sha) => run.commits.includes(sha)),
        ),
    )
    .map(({ entry }) => entry)
}
