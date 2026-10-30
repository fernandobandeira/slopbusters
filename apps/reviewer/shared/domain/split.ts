import { z } from 'zod'
import { organizationSchema } from './preferences'

/**
 * One piece of the PR's diff that a layer takes whole: a hunk of a modified text file, or a whole
 * file when it was added, deleted, renamed, is binary, or changed mode.
 */
export const splitUnitSchema = z.object({
  id: z.string(),
  path: z.string(),
  previousPath: z.string().optional(),
  kind: z.enum(['hunk', 'file']),
  /** A hunk's `@@` header, or why the file is one unit: added, deleted, renamed, binary, mode. */
  header: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type SplitUnit = z.infer<typeof splitUnitSchema>

/** A layer as a model proposes it: what it is called, what it says, and which units it takes. */
export const splitLayerPlanSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(16000),
    units: z.array(z.string().min(1)).min(1).max(5000),
  })
  .strict()
export type SplitLayerPlan = z.infer<typeof splitLayerPlanSchema>

/** What one model turn says about the stack: a new cut of it, or its approval of the current one. */
export const splitTurnSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    approved: z.boolean(),
    issues: z.array(z.string().min(1).max(2000)).max(30),
    /** A new cut, bottom to top; empty keeps the stack as it stands. */
    layers: z.array(splitLayerPlanSchema).max(15).default([]),
  })
  .strict()
export type SplitTurn = z.infer<typeof splitTurnSchema>

/** A layer as built: its commit on top of the one below, and the PR that publishes it. */
export const splitLayerSchema = z.object({
  title: z.string(),
  description: z.string(),
  units: z.array(z.string()),
  branch: z.string(),
  sha: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  pullUrl: z.string().optional(),
  pullNumber: z.number().int().positive().optional(),
})
export type SplitLayer = z.infer<typeof splitLayerSchema>

/** The layers Linus proposed, carried over as the starting point of the cut. */
export const splitPlanLayerSchema = z.object({
  title: z.string(),
  reason: z.string(),
  dependsOn: z.array(z.number().int().min(1)),
  verification: z.string(),
})

export const splitSessionSchema = z.object({
  id: z.string(),
  repository: z.string(),
  url: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string().default(''),
  headBranch: z.string(),
  baseBranch: z.string(),
  headSha: z.string(),
  /** The merge base the layers build on, so the stack shows exactly the PR's diff. */
  baseSha: z.string(),
  primary: organizationSchema,
  companion: organizationSchema,
  status: z.enum(['running', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  createdAt: z.string(),
  error: z.string().optional(),
  failureContext: z.string().optional(),
  linusSessionId: z.string().optional(),
  plan: z.array(splitPlanLayerSchema).default([]),
  guidance: z.string().optional(),
  units: z.array(splitUnitSchema).default([]),
  turns: z
    .array(
      z.object({
        role: z.enum(['primary', 'secondary']),
        round: z.number().int(),
        summary: z.string(),
        issues: z.array(z.string()),
        approved: z.boolean(),
        /** The turn cut the stack again. */
        changed: z.boolean(),
      }),
    )
    .default([]),
  /** The stack as last built, bottom to top. */
  layers: z.array(splitLayerSchema).default([]),
  /** The top layer's tree is the PR head's tree: the stack adds up to the PR, nothing more or less. */
  verified: z.boolean().optional(),
  /** Every layer's branch is pushed and its PR opened. */
  published: z.boolean().optional(),
})
export type SplitSession = z.infer<typeof splitSessionSchema>

/** Why a proposed cut cannot be built, or nothing when every unit lands in exactly one layer. */
export function planProblems(
  layers: readonly SplitLayerPlan[],
  units: readonly SplitUnit[],
): string[] {
  const problems: string[] = []
  if (layers.length < 2) problems.push('A stack needs at least two layers.')
  const known = new Set(units.map((unit) => unit.id))
  const seen = new Map<string, number>()
  for (const [index, layer] of layers.entries())
    for (const id of layer.units) {
      if (!known.has(id)) problems.push(`Layer ${String(index + 1)} names an unknown unit: ${id}.`)
      const first = seen.get(id)
      if (first !== undefined && first !== index)
        problems.push(
          `Unit ${id} is in layer ${String(first + 1)} and layer ${String(index + 1)}; it can be in one.`,
        )
      seen.set(id, index)
    }
  const missing = units.filter((unit) => !seen.has(unit.id)).map((unit) => unit.id)
  if (missing.length)
    problems.push(
      `Every unit must be in a layer; missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` and ${String(missing.length - 20)} more` : ''}.`,
    )
  return problems
}

/** Whether two cuts take the same units into the same layers, whatever they are called. */
export function sameCut(
  left: readonly { units: readonly string[] }[],
  right: readonly { units: readonly string[] }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (layer, index) =>
        JSON.stringify([...layer.units].sort()) ===
        JSON.stringify([...(right[index]?.units ?? [])].sort()),
    )
  )
}
