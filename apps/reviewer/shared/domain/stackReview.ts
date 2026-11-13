import { z } from 'zod'
import { stableId } from './findings'
import {
  groundingEfforts,
  groundingKinds,
  groundingOrigins,
  groundingResolutions,
  groundingRoles,
  groundingVerdicts,
  type GroundingRole,
} from './grounding'
import { panelSeatRequestSchema } from './panel'
import { organizationSchema } from './preferences'

/**
 * A stack review runs the panel on every open layer of a stack, then a cross-layer pass over all
 * layers' grounded entries: what repeats, what one change makes unnecessary elsewhere, which layer
 * owns a change, and what only the whole stack shows. It ends in one stack brief.
 */

/** An entry's id across the stack: its layer and its grounded id, such as `#131/g4`. */
const entryIdSchema = z.string().regex(/^#\d+\/(?:earlier\/)?[\w-]{1,40}$/)
const derivedIdSchema = z.string().regex(/^d\d{1,2}$/)
const pullNumberSchema = z.number().int().positive()

export function stackEntryId(layer: number, entry: string, earlier = false): string {
  return `#${String(layer)}/${earlier ? 'earlier/' : ''}${entry}`
}

/** What happened to one layer's panel in this stack review. */
export const stackLayerStates = ['waiting', 'reused', 'reviewing', 'reviewed', 'stopped'] as const
export const stackLayerSchema = z.object({
  url: z.string(),
  number: pullNumberSchema,
  title: z.string(),
  /** The head and base GitHub reported when the stack review last looked. */
  headSha: z.string().optional(),
  baseSha: z.string().optional(),
  /** The panel session whose result this layer uses or waits for. */
  panel: z.string().optional(),
  state: z.enum(stackLayerStates),
  /** Why the layer stopped the stack review. */
  note: z.string().optional(),
})
export type StackLayer = z.infer<typeof stackLayerSchema>

/** One grounded entry as the cross-layer pass and the brief read it. */
export const stackEntrySchema = z.object({
  id: entryIdSchema,
  layer: pullNumberSchema,
  /** From the layer's previous completed panel round, so a finding raised again shows. */
  earlier: z.boolean().optional(),
  title: z.string(),
  kind: z.enum(groundingKinds).optional(),
  effort: z.enum(groundingEfforts).optional(),
  verdict: z.enum(groundingVerdicts).optional(),
  resolution: z.enum(groundingResolutions),
  disposition: z.enum(['fix', 'skip', 'ask']),
  /** The triage policy's rank within the disposition, lowest first. */
  rank: z.number().int().nonnegative(),
  triage: z.string(),
  /** Triage left it out of the PR as a follow-up: real, but already there or an edge case. */
  followUp: z.boolean(),
  reason: z.string(),
  plan: z.string().optional(),
  question: z.string().optional(),
  evidence: z.array(z.string()),
  /** The PR whose code or metadata must change; absent when grounding left it unresolved. */
  destination: z
    .object({ pull: pullNumberSchema, field: z.enum(['title', 'description']).optional() })
    .optional(),
  origin: z.enum(groundingOrigins).optional(),
  settledBy: pullNumberSchema.optional(),
  raisedBy: z.array(z.string()),
})
export type StackEntry = z.infer<typeof stackEntrySchema>

/** One layer as the pass reads it: its revision, its diff stat and the heads its round read. */
export const stackPassLayerSchema = z.object({
  number: pullNumberSchema,
  title: z.string(),
  url: z.string(),
  reviewedHead: z.string(),
  reviewedBase: z.string(),
  files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** The other layers' heads when this layer's grounding read them. */
  read: z.array(z.object({ pull: pullNumberSchema, headSha: z.string() })),
})
export type StackPassLayer = z.infer<typeof stackPassLayerSchema>

/** What the pass was given, kept so the brief and a resumed debate read the same thing. */
export const stackPassInputSchema = z.object({
  layers: z.array(stackPassLayerSchema),
  entries: z.array(stackEntrySchema),
  /** Entries kept out of the pass to fit its budget; the brief still shows current ones. */
  left: z.array(entryIdSchema),
  limitations: z.array(z.string()),
})
export type StackPassInput = z.infer<typeof stackPassInputSchema>

const reasonSchema = z.string().min(1).max(400)

/** What the cross-layer pass concludes about the whole stack. */
export const crossLayerResultSchema = z
  .object({
    duplicates: z
      .array(
        z
          .object({
            entries: z.array(entryIdSchema).min(2).max(20),
            owner: entryIdSchema,
            reason: reasonSchema,
          })
          .strict(),
      )
      .max(40),
    chains: z
      .array(
        z
          .object({
            cause: entryIdSchema,
            unnecessary: z.array(entryIdSchema).max(20),
            reason: reasonSchema,
          })
          .strict(),
      )
      .max(40),
    ownership: z
      .array(
        z.object({ entry: entryIdSchema, layer: pullNumberSchema, reason: reasonSchema }).strict(),
      )
      .max(40),
    derived: z
      .array(
        z
          .object({
            id: derivedIdSchema,
            title: z.string().min(1).max(200),
            plan: reasonSchema,
            kind: z.enum(groundingKinds),
            effort: z.enum(groundingEfforts),
            layer: pullNumberSchema,
            from: z.array(entryIdSchema).max(20),
          })
          .strict(),
      )
      .max(20),
    structure: z
      .array(
        z
          .object({
            action: z.enum(['drop', 'fold', 'split']),
            layer: pullNumberSchema,
            /** For a fold: the layer that takes the change in. */
            into: pullNumberSchema.optional(),
            reason: reasonSchema,
            cost: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
export type CrossLayerResult = z.infer<typeof crossLayerResultSchema>

const objectionSchema = z
  .object({ item: z.string().min(1).max(60), objection: z.string().min(1).max(400) })
  .strict()

/** One model's turn: the whole result, whether it approves it, and what it objects to. */
export const crossLayerTurnSchema = crossLayerResultSchema
  .extend({
    approved: z.boolean(),
    summary: z.string().min(1).max(1500),
    objections: z.array(objectionSchema).max(40),
  })
  .strict()
export type CrossLayerTurn = z.infer<typeof crossLayerTurnSchema>

const positionSchema = z.object({
  result: crossLayerResultSchema,
  objections: z.array(objectionSchema),
})

/** The debate over the pass, saved after every valid turn so a retry resumes it. */
export const crossLayerStateSchema = z.object({
  roles: z.object({ primary: organizationSchema, secondary: organizationSchema.optional() }),
  turns: z.array(
    z.object({
      role: z.enum(groundingRoles),
      model: organizationSchema,
      summary: z.string(),
      changed: z.boolean(),
      approved: z.boolean(),
      objections: z.array(objectionSchema),
    }),
  ),
  /** The last valid result. */
  result: crossLayerResultSchema.optional(),
  positions: z.object({ primary: positionSchema.optional(), secondary: positionSchema.optional() }),
  outcome: z.enum(['agreed', 'exhausted', 'single']).optional(),
  /** Items of the last result that the other model did not approve, by `itemKey`. */
  contested: z.array(z.string()).optional(),
})
export type CrossLayerState = z.infer<typeof crossLayerStateSchema>

export const stackReviewSessionSchema = z.object({
  id: z.string(),
  repository: z.string(),
  /** The PR the review started from. */
  url: z.string(),
  /** Every layer's URL, bottom to top, so a review can be found from any of them. */
  urls: z.array(z.string()),
  reviewers: z.array(panelSeatRequestSchema),
  status: z.enum(['running', 'partial', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  error: z.string().optional(),
  createdAt: z.string(),
  layers: z.array(stackLayerSchema),
  input: stackPassInputSchema.optional(),
  pass: crossLayerStateSchema.optional(),
})
export type StackReviewSession = z.infer<typeof stackReviewSessionSchema>

/** What the pass may refer to: the entries it was given and the stack's layers. */
export interface CrossLayerScope {
  entries: readonly Pick<StackEntry, 'id' | 'earlier'>[]
  layers: readonly number[]
}

/**
 * Why a returned result does not fit the input, one problem per line; empty when it is valid.
 * Every id must be one the pass was given, used at most once per relation, and only a current
 * entry can own a change. A derived finding needs the entries it was derived from.
 */
export function crossLayerProblems(turn: CrossLayerResult, scope: CrossLayerScope): string[] {
  const known = new Map(scope.entries.map((entry) => [entry.id, entry]))
  const check = relationChecker(known, scope.layers)
  const merged = new Set(
    turn.duplicates.flatMap((group) => group.entries.filter((id) => id !== group.owner)),
  )
  const owned = (relation: string, ids: readonly string[]) => {
    for (const id of ids)
      if (merged.has(id))
        check.problem(
          `${relation}: ${id} is merged into a duplicate group; name its owner instead.`,
        )
  }
  for (const group of turn.duplicates) {
    check.ids('duplicates', group.entries)
    if (!group.entries.includes(group.owner))
      check.problem(`duplicates: the owner ${group.owner} must be one of its group's entries.`)
    check.current('duplicates', group.owner)
  }
  for (const chain of turn.chains) {
    check.ids('chains', [chain.cause, ...chain.unnecessary])
    for (const id of [chain.cause, ...chain.unnecessary]) check.current('chains', id)
    owned('chains', [chain.cause, ...chain.unnecessary])
    if (!chain.unnecessary.length)
      check.problem(`chains: ${chain.cause} needs the entries it makes unnecessary.`)
  }
  for (const item of turn.ownership) {
    check.ids('ownership', [item.entry])
    check.current('ownership', item.entry)
    owned('ownership', [item.entry])
    check.layer('ownership', item.layer)
  }
  derivedProblems(turn, check)
  const reshaped = new Set<number>()
  for (const item of turn.structure) {
    if (reshaped.has(item.layer))
      check.problem(`structure: PR #${String(item.layer)} has more than one proposal; keep one.`)
    reshaped.add(item.layer)
    if (item.into === item.layer)
      check.problem(`structure: PR #${String(item.layer)} cannot fold into itself.`)
    check.layer('structure', item.layer)
    if (item.into !== undefined) check.layer('structure', item.into)
    if ((item.action === 'fold') !== (item.into !== undefined))
      check.problem(`structure: only a fold names the layer it goes into (#${String(item.layer)}).`)
  }
  return check.problems
}

function derivedProblems(turn: CrossLayerResult, check: ReturnType<typeof relationChecker>) {
  const ids = new Set<string>()
  for (const item of turn.derived) {
    if (ids.has(item.id)) check.problem(`derived: ${item.id} is used twice.`)
    ids.add(item.id)
    if (!item.from.length)
      check.problem(`derived: ${item.id} needs the entries it was derived from in from.`)
    check.ids(`derived ${item.id}`, item.from)
    check.layer('derived', item.layer)
  }
}

function relationChecker(
  known: ReadonlyMap<string, Pick<StackEntry, 'earlier'>>,
  layers: readonly number[],
) {
  const problems: string[] = []
  const used = new Map<string, Set<string>>()
  return {
    problems,
    problem: (text: string) => problems.push(text),
    /** Each id is known, and appears at most once in the relation. */
    ids(relation: string, ids: readonly string[]) {
      const seen = used.get(relation) ?? new Set<string>()
      used.set(relation, seen)
      for (const id of ids) {
        if (!known.has(id)) problems.push(`${relation}: ${id} is not an entry you were given.`)
        else if (seen.has(id)) problems.push(`${relation}: ${id} is used more than once.`)
        seen.add(id)
      }
    },
    /** Only an entry of the current rounds can own, cause or be moved. */
    current(relation: string, id: string) {
      if (known.get(id)?.earlier)
        problems.push(`${relation}: ${id} is from an earlier round and cannot take this role.`)
    },
    layer(relation: string, layer: number) {
      if (!layers.includes(layer))
        problems.push(`${relation}: PR #${String(layer)} is not a layer of this stack.`)
    },
  }
}

/** The schema a turn's reply must meet, with the ids checked so a bad result is corrected. */
export function crossLayerReplySchema(scope: CrossLayerScope) {
  return crossLayerTurnSchema.superRefine((turn, context) => {
    for (const message of crossLayerProblems(turn, scope))
      context.addIssue({ code: 'custom', message })
  })
}

/** Every conclusion of a result by a key that names what it is about, with its substance. */
export function resultItems(result: CrossLayerResult): Map<string, string> {
  const items: (readonly [string, unknown])[] = [
    ...result.duplicates.map(
      (item) => [`duplicate ${item.owner}`, sorted(item, 'entries')] as const,
    ),
    ...result.chains.map((item) => [`chain ${item.cause}`, sorted(item, 'unnecessary')] as const),
    ...result.ownership.map((item) => [`ownership ${item.entry}`, item] as const),
    ...result.derived.map((item) => [`derived ${item.id}`, sorted(item, 'from')] as const),
    ...result.structure.map((item) => [`structure #${String(item.layer)}`, item] as const),
  ]
  return new Map(items.map(([key, value]) => [key, stableId('item', [canonical(value)])]))
}

/** Whether two results say the same thing, in any order. */
export function sameResult(a: CrossLayerResult, b: CrossLayerResult): boolean {
  const left = resultItems(a)
  const right = resultItems(b)
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value)
}

/**
 * The items of the last result the other model did not approve: it never held them as they are,
 * or it objected to what they are about. Empty unless the turns ran out: when both agreed there
 * is nothing to mark, and with one model the brief says nothing was checked.
 */
export function contestedItems(state: CrossLayerState): string[] {
  if (state.outcome !== 'exhausted' || !state.result) return []
  const last = state.turns.at(-1)?.role
  const other: GroundingRole = last === 'secondary' ? 'primary' : 'secondary'
  const position = state.positions[other]
  if (!position) return [...resultItems(state.result).keys()]
  const held = resultItems(position.result)
  const objected = [...position.objections, ...(state.turns.at(-1)?.objections ?? [])].map(
    (objection) => objection.item,
  )
  return [...resultItems(state.result)]
    .filter(([key, value]) => held.get(key) !== value || objected.some((id) => key.endsWith(id)))
    .map(([key]) => key)
}

function sorted<T extends object>(item: T, field: keyof T): T {
  const list = item[field]
  return Array.isArray(list) ? { ...item, [field]: [...(list as string[])].sort() } : item
}

function canonical(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
}

/** Where one layer stands in a stack review, in words. */
export function layerProgress(layer: StackLayer): string {
  switch (layer.state) {
    case 'waiting':
      return 'Not looked at yet.'
    case 'reused':
      return 'Reuses its panel result, reviewed at its current head.'
    case 'reviewing':
      return 'The panel is reviewing it.'
    case 'reviewed':
      return 'The panel reviewed it.'
    case 'stopped':
      return layer.note ?? 'Its panel stopped.'
  }
}
