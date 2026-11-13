import { z } from 'zod'
import type { Anchor } from './anchors'
import type { PanelFinding } from './panel'

export const fixCheckStatuses = ['applied', 'partial', 'missing', 'wrong'] as const

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
