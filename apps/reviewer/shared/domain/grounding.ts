import { z } from 'zod'
import { stableId } from './findings'
import { panelFindingSchema, seatIdSchema, type PanelFinding } from './panel'
import { organizationSchema } from './preferences'

/**
 * Grounding checks the panel's findings against the code. Two models, one per provider, take
 * turns on one list of grounded entries until both approve it unchanged. Every finding a seat
 * returned is accounted for: grounded in an entry, or deferred to a later round.
 */
export const groundingVerdicts = [
  'legit',
  'notTrue',
  'overEngineering',
  'tasteSkip',
  'authorsCall',
] as const
export type GroundingVerdict = (typeof groundingVerdicts)[number]
export const groundingVerdictLabels: Record<GroundingVerdict, string> = {
  legit: 'Worth fixing',
  notTrue: 'Not true',
  overEngineering: 'Over-engineering',
  tasteSkip: 'Taste, safe to skip',
  authorsCall: "Author's call",
}
export const groundingRoles = ['primary', 'secondary'] as const
export type GroundingRole = (typeof groundingRoles)[number]
export const groundingResolutions = ['agreed', 'disputed', 'unverified'] as const
export type GroundingResolution = (typeof groundingResolutions)[number]
export const groundingResolutionLabels: Record<GroundingResolution, string> = {
  agreed: 'Both models agree',
  disputed: 'The models disagree',
  unverified: 'Not checked by a second model',
}

/** The short key a round gives a seat's finding, so colliding seat-local ids stay distinct. */
const sourceKeySchema = z.string().regex(/^f\d{1,3}$/)

/** A seat's finding as grounding sees it: the round's key for it, where it came from, its rank. */
export const groundingCandidateSchema = z.object({
  key: sourceKeySchema,
  pull: z.number().int().positive(),
  seat: seatIdSchema,
  /** Its position in the seat's own ranked list, from 0. */
  rank: z.number().int().nonnegative(),
  finding: panelFindingSchema,
  /** Selected for this round's budget, or deferred to a later round without a verdict. */
  state: z.enum(['selected', 'deferred']),
})
export type GroundingCandidate = z.infer<typeof groundingCandidateSchema>

const destinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), pull: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal('metadata'),
      pull: z.number().int().positive(),
      field: z.enum(['title', 'description']),
    })
    .strict(),
  z.object({ kind: z.literal('unresolved'), reason: z.string().min(1).max(300) }).strict(),
])

/** One grounded entry: the sources it stands for, the verdict on them and what to do next. */
export const groundedEntrySchema = z
  .object({
    id: z.string().min(1).max(40),
    sources: z.array(sourceKeySchema).min(1).max(40),
    /** Absent when the evidence needed to decide is unavailable; `missing` says what it is. */
    verdict: z.enum(groundingVerdicts).optional(),
    reason: z.string().min(1).max(400),
    /** `path:line` for code, or `title: …`/`description: …` quoting the PR's metadata. */
    evidence: z.array(z.string().min(1).max(200)).max(4),
    missing: z.string().min(1).max(300).optional(),
    /** Required for `legit`: the change to make, in one to three lines. */
    plan: z.string().min(1).max(400).optional(),
    /** Required for `authorsCall`: the decision only the author can make. */
    question: z.string().min(1).max(300).optional(),
    destination: destinationSchema,
  })
  .strict()
export type GroundedEntry = z.infer<typeof groundedEntrySchema>

const objectionSchema = z
  .object({ entry: z.string().min(1).max(40), objection: z.string().min(1).max(400) })
  .strict()

/** One model's turn: the whole updated list, whether it approves it, and what it objects to. */
export const groundingTurnSchema = z
  .object({
    entries: z.array(groundedEntrySchema).max(40),
    approved: z.boolean(),
    summary: z.string().min(1).max(1500),
    objections: z.array(objectionSchema).max(40),
  })
  .strict()
export type GroundingTurn = z.infer<typeof groundingTurnSchema>

const positionSchema = z.object({
  /** The list as this role last returned it. */
  entries: z.array(groundedEntrySchema),
  objections: z.array(objectionSchema),
})

const turnRecordSchema = z.object({
  role: z.enum(groundingRoles),
  model: organizationSchema,
  summary: z.string(),
  changed: z.boolean(),
  approved: z.boolean(),
  objections: z.array(objectionSchema),
})

export const resolvedEntrySchema = groundedEntrySchema.extend({
  resolution: z.enum(groundingResolutions),
  /** The seats behind the sources, derived from them rather than written by a model. */
  raisedBy: z.array(seatIdSchema).min(1),
  /** What the other model held about these sources, when it differs. */
  other: z
    .object({
      role: z.enum(groundingRoles),
      entries: z.array(groundedEntrySchema),
      objections: z.array(z.string()),
    })
    .optional(),
})
export type ResolvedEntry = z.infer<typeof resolvedEntrySchema>

/** How the debate ended: both approved one list, the turns ran out, or one model was available. */
export const groundingOutcomes = ['agreed', 'exhausted', 'single'] as const

export const groundingStateSchema = z.object({
  /** How many sources this round could ground. */
  budget: z.number().int().positive(),
  candidates: z.array(groundingCandidateSchema),
  roles: z.object({ primary: organizationSchema, secondary: organizationSchema.optional() }),
  turns: z.array(turnRecordSchema),
  /** The last valid list. */
  entries: z.array(groundedEntrySchema),
  positions: z.object({ primary: positionSchema.optional(), secondary: positionSchema.optional() }),
  outcome: z.enum(groundingOutcomes).optional(),
  /** The entries with their resolution, once the debate ended. */
  resolved: z.array(resolvedEntrySchema).optional(),
})
export type GroundingState = z.infer<typeof groundingStateSchema>

/**
 * Pick this round's sources: each seat's next ranked finding in roster order until the budget is
 * full, so no seat takes the whole budget and each keeps its own ranking. Every other finding is
 * kept as deferred: not rejected, only not grounded yet.
 */
export function selectCandidates(
  pull: number,
  reviews: readonly { reviewer: string; advice?: { findings: readonly PanelFinding[] } }[],
  budget: number,
): GroundingCandidate[] {
  const queues = reviews.map((review) => ({
    seat: review.reviewer,
    findings: review.advice?.findings ?? [],
  }))
  const picked: Omit<GroundingCandidate, 'key' | 'state'>[] = []
  const deepest = Math.max(0, ...queues.map((queue) => queue.findings.length))
  for (let rank = 0; rank < deepest; rank++)
    for (const { seat, findings } of queues) {
      const finding = findings[rank]
      if (finding) picked.push({ pull, seat, rank, finding })
    }
  return picked.map((candidate, index) => ({
    ...candidate,
    key: `f${String(index + 1)}`,
    state: index < budget ? 'selected' : 'deferred',
  }))
}

/** What the grounded list may refer to: the selected sources and the PRs it can change. */
export interface GroundingScope {
  candidates: readonly GroundingCandidate[]
  /** The PR under review and its loaded stack layers. */
  pulls: readonly number[]
}

const evidenceReference = /^(?:\S+:\d+(?:-\d+)?|(?:title|description): \S.*)$/s

/**
 * Why a returned list breaks the round's accounting or the verdict rules, one problem per entry;
 * empty when it is valid. Selected sources must be partitioned exactly: each in one entry, none
 * unknown, deferred or invented.
 */
export function groundingProblems(turn: GroundingTurn, scope: GroundingScope): string[] {
  const selected = new Map(
    scope.candidates
      .filter((candidate) => candidate.state === 'selected')
      .map((candidate) => [candidate.key, candidate]),
  )
  const problems: string[] = []
  const seen = new Set<string>()
  const ids = new Set<string>()
  for (const entry of turn.entries) {
    if (ids.has(entry.id)) problems.push(`Entry id ${entry.id} is used twice.`)
    ids.add(entry.id)
    for (const key of entry.sources) {
      if (!selected.has(key)) problems.push(`${entry.id} cites ${key}, which is not a source.`)
      else if (seen.has(key)) problems.push(`${key} appears in more than one entry.`)
      seen.add(key)
    }
    problems.push(...entryProblems(entry, scope, selected))
  }
  const omitted = [...selected.keys()].filter((key) => !seen.has(key))
  if (omitted.length) problems.push(`No entry accounts for ${omitted.join(', ')}.`)
  for (const { entry } of turn.objections)
    if (!ids.has(entry)) problems.push(`An objection names ${entry}, which is not in the list.`)
  return problems
}

function entryProblems(
  entry: GroundedEntry,
  scope: GroundingScope,
  selected: ReadonlyMap<string, GroundingCandidate>,
): string[] {
  const problems = [...verdictProblems(entry), ...evidenceProblems(entry)]
  if (entry.destination.kind !== 'unresolved' && !scope.pulls.includes(entry.destination.pull))
    problems.push(`PR #${String(entry.destination.pull)} is not this PR or a loaded layer.`)
  const decisions = entry.sources.every((key) => selected.get(key)?.finding.tag === 'decision')
  if (decisions && entry.verdict && !['authorsCall', 'notTrue'].includes(entry.verdict))
    problems.push(
      "its sources are questions for the author; it stays an author's call unless code disproves it.",
    )
  return problems.map((problem) => `${entry.id}: ${problem}`)
}

/** What each verdict requires: a plan, a question, or what is missing when there is none. */
function verdictProblems(entry: GroundedEntry): string[] {
  const problems: string[] = []
  if (!entry.verdict && !entry.missing)
    problems.push('without a verdict, say in missing which evidence would settle it.')
  if (entry.verdict && entry.missing)
    problems.push(
      'missing is only for an entry the evidence cannot settle; drop it or the verdict.',
    )
  if (entry.verdict === 'legit' && !entry.plan) problems.push('a legit entry needs a plan.')
  if (entry.verdict === 'authorsCall' && !entry.question)
    problems.push("an author's call needs the question to ask.")
  return problems
}

/** A rejection cites what was inspected, and every reference is one a reader can open. */
function evidenceProblems(entry: GroundedEntry): string[] {
  const problems: string[] = []
  if (
    (entry.verdict === 'notTrue' || entry.verdict === 'overEngineering') &&
    !entry.evidence.length
  )
    problems.push(
      `${entry.verdict} needs evidence you inspected, as path:line or a metadata quote.`,
    )
  for (const reference of entry.evidence)
    if (!evidenceReference.test(reference))
      problems.push(
        `evidence "${reference}" is neither path:line nor a title: or description: quote.`,
      )
  return problems
}

/** The schema a turn's reply must meet, with the accounting checked so a bad list is corrected. */
export function groundingReplySchema(scope: GroundingScope) {
  return groundingTurnSchema.superRefine((turn, context) => {
    for (const message of groundingProblems(turn, scope))
      context.addIssue({ code: 'custom', message })
  })
}

/** An entry's substance, ignoring its id and the order of its sources and evidence. */
export function entryRevision(entry: GroundedEntry): string {
  const { id: _id, sources, evidence, ...rest } = entry
  return stableId('entry', [[...sources].sort(), [...evidence].sort(), canonical(rest)])
}

/** A list's substance, in any order; two lists with the same revision say the same thing. */
export function listRevision(entries: readonly GroundedEntry[]): string {
  return stableId('list', entries.map(entryRevision).sort())
}

function canonical(value: object): unknown {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
}

/** The finding a grounded entry leads with: its highest-ranked source. */
export function leadSource(
  entry: Pick<GroundedEntry, 'sources'>,
  candidates: readonly GroundingCandidate[],
): GroundingCandidate | undefined {
  return candidates
    .filter((candidate) => entry.sources.includes(candidate.key))
    .sort((a, b) => a.rank - b.rank || keyOrder(a.key) - keyOrder(b.key))[0]
}

export function keyOrder(key: string): number {
  return Number(key.slice(1))
}
