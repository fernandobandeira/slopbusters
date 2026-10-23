import { z } from 'zod'
import type { Anchor } from './anchors'
import type { PanelFinding } from './panel'

export const fixCheckStatuses = ['applied', 'partial', 'missing', 'wrong'] as const
export const fixCheckLabels: Record<(typeof fixCheckStatuses)[number], string> = {
  applied: 'Applied',
  partial: 'Partly applied',
  missing: 'Not applied',
  wrong: 'Applied wrongly',
}

/** What the other provider's model found when it checked the committed fixes against the plans. */
export const fixCheckSchema = z.object({
  /** The local commit it read. */
  sha: z.string(),
  model: z.object({ provider: z.string(), model: z.string() }),
  summary: z.string(),
  results: z.array(
    z.object({
      entry: z.string(),
      status: z.enum(fixCheckStatuses),
      note: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
  createdAt: z.string(),
})
export type FixCheck = z.infer<typeof fixCheckSchema>

/**
 * The fixes the author sent from one reviewed PR to a T3 Code thread. Saved before the launch so a
 * repeated or retried Proceed finds it instead of starting a second thread; `sent` only once the
 * thread exists and has its first message.
 */
export const fixHandoffSchema = z.object({
  /** The gate revision the author proceeded from. */
  revision: z.string(),
  /** Chosen before the launch, so a retry reuses it. */
  threadId: z.string(),
  state: z.enum(['preparing', 'sent', 'failed']),
  createdAt: z.string(),
  /** The grounded entries the thread was asked to fix. */
  entries: z.array(z.string()),
  error: z.string().optional(),
  /** The last check of the committed fixes by the other provider's model. */
  check: fixCheckSchema.optional(),
  launch: z
    .object({
      title: z.string(),
      project: z.string(),
      location: z.enum(['t3code', 'slopbusters']),
      branch: z.string(),
      worktreePath: z.string(),
      /** The PR head the panel reviewed; the worktree starts here. */
      reviewedSha: z.string(),
      baseSha: z.string(),
    })
    .optional(),
})
export type FixHandoff = z.infer<typeof fixHandoffSchema>

/** The branch a PR's fixes are committed on, beside the PR's own branch, never pushed. */
export function fixBranch(pull: { number: number }, sha: string): string {
  return `slopbusters/fix-${String(pull.number)}-${sha.slice(0, 7)}`
}

/** A grounded finding the author sent to another layer's round; it is grounded again there. */
export const layerRouteSchema = z.object({
  pull: z.number().int().positive(),
  /** The panel round started on that layer. */
  session: z.string(),
  entries: z.array(z.string()),
  createdAt: z.string(),
})
export type LayerRoute = z.infer<typeof layerRouteSchema>

/** A new title or description drafted from the chosen metadata plans, never published. */
export const metadataDraftSchema = z.object({
  field: z.enum(['title', 'description']),
  text: z.string(),
  entries: z.array(z.string()),
  createdAt: z.string(),
})
export type MetadataDraft = z.infer<typeof metadataDraftSchema>

/** A source finding carried into another layer's round, with where it came from. */
export interface CarriedFinding {
  /** The layer's PR URL, whose round grounds it. */
  url: string
  from: { pull: number; entry: string }
  seat: string
  finding: PanelFinding
}

/** A finding's location as the target layer sees it: a stack anchor on that layer unwraps. */
export function carriedAnchor(anchor: Anchor, pull: number): Anchor {
  return anchor.kind === 'stack' && anchor.pull === pull ? anchor.location : anchor
}

/**
 * A round over a fix branch's local commits, which GitHub does not have. Its PR snapshot has the
 * local head, so comments, which GitHub would place against its own head, stay off.
 */
export const localRoundSchema = z.object({
  url: z.string(),
  worktreePath: z.string(),
  branch: z.string(),
  /** The committed local head this round reviews. */
  sha: z.string(),
  /** The PR head the fixes started from, which GitHub may still have. */
  reviewedSha: z.string(),
  /** What the local diff is against: the reviewed PR's merge base. */
  mergeBaseSha: z.string(),
  /** The panel round whose fixes these are. */
  from: z.string(),
})
export type LocalRound = z.infer<typeof localRoundSchema>
