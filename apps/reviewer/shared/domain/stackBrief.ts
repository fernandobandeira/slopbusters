import { type ResolvedEntry } from './grounding'
import { isSerious } from './impact'
import type {
  CrossLayerResult,
  StackEntry,
  StackPassInput,
  StackReviewSession,
} from './stackReview'
import {
  contestedDoubts,
  entryDecisions,
  structureDecisions,
  type BriefDecision,
} from './stackDecisions'
import type {
  DecisionProvenance,
  DecisionRecord,
  ObservedLayer,
  StackDisposition,
} from './stackReviewRecords'
import { triage } from './triage'
import { briefLayers, staleEntries, type BriefLayer, type BriefStale } from './stackBriefLayers'

/**
 * The stack brief: one place to work a whole stack from, for a person or a coding agent. Its
 * structure is what an agent applies, so every item keeps its entry id and its layer.
 */
export interface StackBrief {
  layers: BriefLayer[]
  summary?: string
  /** Entries with a serious consequence, wherever triage put them: each needs a disposition. */
  serious: BriefSerious[]
  /** One queue across the stack: questions for the author and proposals to reshape the stack. */
  decisions: BriefDecision[]
  /** Bottom to top, each layer's fixes in triage order. */
  fixes: { layer: BriefLayer; items: BriefFix[] }[]
  chains: BriefChain[]
  /** Entries triage left for later: problems already there, or cases needing several failures. */
  followUps: BriefFollowUp[]
  unread: BriefEntry[]
  stale: BriefStale[]
  limitations: string[]
  review?: {
    answered: BriefAnswer[]
    history: DecisionRecord[]
    pending: Map<string, PendingDecision>
  }
}
export interface PendingDecision {
  revision: number
  stale: boolean
  serious: boolean
}

export interface BriefAnswer {
  decision: BriefDecision
  record: DecisionRecord & { answer: NonNullable<DecisionRecord['answer']> }
  option?: BriefDecision['options'][number]
  revision: number
  recheck: boolean
  confirmableAt?: ObservedLayer[]
  manual: boolean
}
export interface BriefFix {
  id: string
  title: string
  plan?: string
  kind?: StackEntry['kind']
  effort?: StackEntry['effort']
  triage: string
  /** A finding only the whole stack shows, with the entries it was derived from. */
  derivedFrom?: string[]
  /** The other entries that made the same point, which this one owns. */
  alsoRaised: string[]
  decision?: DecisionProvenance
  applied?: true
  /** The layer grounding sent it to, when the pass moved it here. */
  movedFrom?: { layer: number; reason: string }
  /** The title or description, when the change is to the PR's metadata rather than its code. */
  field?: 'title' | 'description'
}
export interface BriefSerious {
  id: string
  layer: number
  title: string
  impact: NonNullable<StackEntry['impact']>
  consequence: string
  /** Only one model claims it; the other rejected or lowered it. */
  contested: boolean
  /** Where it is in this brief: a fix, a decision, a reply, a follow-up, or set aside and why. */
  standing: string
  entryIds: string[]
  relatedLayers: number[]
  disposition?: StackDisposition
  revision?: number
}
export interface BriefChain {
  cause: BriefEntry
  reason: string
  unnecessary: BriefEntry[]
}
export interface BriefFollowUp {
  id: string
  layer: number
  title: string
  triage: string
}
interface BriefEntry {
  id: string
  layer: number
  title: string
}

const emptyResult: CrossLayerResult = {
  duplicates: [],
  chains: [],
  ownership: [],
  derived: [],
  structure: [],
}

/** The brief of a stack review whose cross-layer pass has its input; undefined before then. */
export function stackBrief(session: StackReviewSession): StackBrief | undefined {
  const { input, pass } = session
  if (!input) return undefined
  const contested = new Set(pass?.contested ?? [])
  const proposed = pass?.result ?? emptyResult
  const result = approved(proposed, contested)
  const layers = briefLayers(session, input)
  const plan = placement(input, result)
  const doubts = contestedDoubts(proposed, contested, plan)
  const unmerged = input.entries.filter((entry) => !plan.merged(entry.id))
  const current = unmerged.filter((entry) => !plan.unnecessary(entry.id))
  const derived = proposed.derived.map((item) => ({ item, entry: derivedEntry(item) }))
  return {
    layers,
    ...(pass?.turns.at(-1)?.summary ? { summary: pass.turns.at(-1)?.summary } : {}),
    serious: seriousEntries([...input.entries, ...derived.map(({ entry }) => entry)], {
      plan,
      doubts,
      result,
    }),
    decisions: [
      // A question stays even when a chain would make it unnecessary: that change is not settled.
      ...entryDecisions(
        [
          ...unmerged.filter(
            (entry) =>
              entry.disposition === 'ask' ||
              entry.disposition === 'prepare' ||
              (entry.disposition === 'fix' && doubts.has(entry.id)),
          ),
          ...derived
            .filter(
              ({ item, entry }) =>
                entry.disposition === 'ask' || (entry.disposition === 'fix' && doubts.has(item.id)),
            )
            .map(({ entry }) => entry),
        ],
        { doubts, contested, entry: plan.entry, layerOf: plan.layerOf },
      ).map((decision) => decisionContext(decision, derived, plan)),
      ...structureDecisions(result.structure, contested),
    ],
    fixes: layers
      .map((layer) => ({
        layer,
        items: fixesOn(layer.number, {
          current: current.filter((entry) => !doubts.has(entry.id)),
          result,
          plan,
        }),
      }))
      .filter((group) => group.items.length),
    chains: result.chains.flatMap(({ cause, reason, unnecessary }) => {
      const entry = plan.briefEntries([cause])[0]
      return entry ? [{ cause: entry, reason, unnecessary: plan.briefEntries(unnecessary) }] : []
    }),
    followUps: [...current, ...derived.map(({ entry }) => entry)]
      .filter((entry) => entry.followUp)
      .map((entry) => ({
        id: entry.id,
        layer: entry.layer,
        title: entry.title,
        triage: entry.triage,
      })),
    stale: staleEntries(input, layers),
    unread: plan.briefEntries(input.left),
    limitations: [...input.limitations, ...passLimitations(session)],
  }
}

function decisionContext(
  decision: BriefDecision,
  derived: { item: CrossLayerResult['derived'][number] }[],
  plan: ReturnType<typeof placement>,
): BriefDecision {
  const relatedEntries = [
    ...(decision.relatedEntries ?? []),
    ...(derived.find(({ item }) => item.id === decision.id)?.item.from ?? []),
    ...decision.evidence.flatMap(({ id }) => plan.alsoRaised(id)),
  ]
  return {
    ...decision,
    relatedEntries,
    relatedLayers: relatedEntries.flatMap((id) => {
      const entry = plan.entry(id)
      return entry
        ? [entry.layer, plan.layerOf(entry), ...(entry.settledBy ? [entry.settledBy] : [])]
        : []
    }),
  }
}

interface Standing {
  plan: ReturnType<typeof placement>
  doubts: ReturnType<typeof contestedDoubts>
  result: CrossLayerResult
}

/**
 * Each serious entry with where the brief puts it, including one merged into a duplicate: the
 * owner of a group may not carry the serious consequence itself.
 */
function seriousEntries(entries: readonly StackEntry[], standing: Standing): BriefSerious[] {
  return entries.filter(isSerious).map((entry) => ({
    ...seriousContext(entry, standing),
    id: entry.id,
    layer: entry.layer,
    title: entry.title,
    impact: entry.impact,
    consequence: entry.consequence ?? entry.reason,
    contested: entry.impactContested ?? false,
    standing: seriousStanding(entry, standing),
  }))
}

function seriousContext(entry: StackEntry, { plan, result }: Standing) {
  const entries = [
    entry.id,
    ...result.duplicates
      .filter((group) => group.entries.includes(entry.id))
      .flatMap((group) => group.entries),
    ...result.chains
      .filter((chain) => chain.unnecessary.includes(entry.id))
      .map((chain) => chain.cause),
    ...(result.derived.find((item) => item.id === entry.id)?.from ?? []),
  ]
  return {
    entryIds: [...new Set(entries)].sort(),
    relatedLayers: [plan.layerOf(entry), ...entries.flatMap((id) => plan.entry(id)?.layer ?? [])],
  }
}

function seriousStanding(entry: StackEntry, { plan, doubts, result }: Standing): string {
  const owner = result.duplicates.find(
    (group) => group.owner !== entry.id && group.entries.includes(entry.id),
  )?.owner
  if (owner && plan.merged(entry.id))
    return `merged into ${owner} (${plan.title(owner)}); that entry carries the change, and this consequence with it.`
  const cause = result.chains.find((chain) => chain.unnecessary.includes(entry.id))?.cause
  if (cause)
    return `would be unnecessary once ${cause} (${plan.title(cause)}) is applied and checked.`
  if (entry.followUp) return `left for a follow-up. ${entry.triage}`
  if (entry.disposition === 'ask' || doubts.has(entry.id))
    return `needs your decision. ${entry.triage}`
  if (entry.disposition === 'fix') return `a fix on PR #${String(plan.layerOf(entry))}.`
  if (entry.disposition === 'prepare') return `a predicted reviewer comment. ${entry.triage}`
  return `not chosen. ${entry.triage}`
}

/** The conclusions both models approved; structure proposals are decisions either way. */
function approved(result: CrossLayerResult, contested: ReadonlySet<string>): CrossLayerResult {
  return {
    duplicates: result.duplicates.filter((item) => !contested.has(`duplicate ${item.owner}`)),
    chains: result.chains.filter((item) => !contested.has(`chain ${item.cause}`)),
    ownership: result.ownership.filter((item) => !contested.has(`ownership ${item.entry}`)),
    derived: result.derived.filter((item) => !contested.has(`derived ${item.id}`)),
    structure: result.structure,
  }
}

/**
 * Where each entry lands: merged into the owner of its duplicate group, made unnecessary by a
 * chain, or on the layer whose code must change, as the pass corrected it.
 */
function placement(input: StackPassInput, result: CrossLayerResult) {
  const byId = new Map(input.entries.map((entry) => [entry.id, entry]))
  const merged = new Set(
    result.duplicates.flatMap((group) => group.entries.filter((id) => id !== group.owner)),
  )
  const unnecessary = new Set(result.chains.flatMap((chain) => chain.unnecessary))
  const moved = new Map(result.ownership.map((item) => [item.entry, item]))
  const layers = new Set(input.layers.map((layer) => layer.number))
  return {
    entry: (id: string) => byId.get(id),
    briefEntries: (ids: readonly string[]): BriefEntry[] =>
      ids.flatMap((id) => {
        const entry = byId.get(id)
        return entry ? [{ id, layer: entry.layer, title: entry.title }] : []
      }),
    merged: (id: string) => merged.has(id),
    unnecessary: (id: string) => unnecessary.has(id),
    title: (id: string) => byId.get(id)?.title ?? id,
    moved: (id: string) => moved.get(id),
    alsoRaised: (id: string) =>
      result.duplicates
        .filter((group) => group.owner === id)
        .flatMap((group) => group.entries.filter((other) => other !== id)),
    layerOf: (entry: StackEntry): number => {
      const target = moved.get(entry.id)?.layer ?? entry.destination?.pull ?? entry.layer
      return layers.has(target) ? target : entry.layer
    },
  }
}

function fixesOn(
  layer: number,
  {
    current: entries,
    result,
    plan,
  }: {
    current: readonly StackEntry[]
    result: CrossLayerResult
    plan: ReturnType<typeof placement>
  },
): BriefFix[] {
  const own = entries
    .filter((entry) => entry.disposition === 'fix' && plan.layerOf(entry) === layer)
    .map((entry) => {
      const moved = plan.moved(entry.id)
      return {
        entry,
        fix: {
          ...fixOf(entry),
          alsoRaised: plan.alsoRaised(entry.id),
          ...(moved
            ? { movedFrom: { layer: entry.destination?.pull ?? entry.layer, reason: moved.reason } }
            : {}),
        },
      }
    })
  const derived = result.derived
    .filter((item) => item.layer === layer)
    .map((item) => ({ item, entry: derivedEntry(item) }))
    .filter(({ entry }) => entry.disposition === 'fix')
    .map(({ item, entry }) => ({
      entry,
      fix: {
        ...fixOf(entry),
        derivedFrom: item.from,
        alsoRaised: [],
      },
    }))
  return [...own, ...derived].sort((a, b) => a.entry.rank - b.entry.rank).map(({ fix }) => fix)
}

function fixOf(entry: StackEntry): Omit<BriefFix, 'alsoRaised'> {
  return {
    id: entry.id,
    title: entry.title,
    triage: entry.triage,
    ...(entry.plan ? { plan: entry.plan } : {}),
    ...(entry.kind ? { kind: entry.kind } : {}),
    ...(entry.effort ? { effort: entry.effort } : {}),
    ...(entry.destination?.field ? { field: entry.destination.field } : {}),
  }
}

/**
 * A derived finding as an entry, so the same triage policy places it: both models stated it as
 * a change to make, so it is treated as an agreed finding worth fixing.
 */
function derivedEntry(item: CrossLayerResult['derived'][number]): StackEntry {
  const resolved: ResolvedEntry = {
    id: item.id,
    sources: ['f1'],
    verdict: 'legit',
    reason: item.plan,
    evidence: [],
    plan: item.plan,
    origin: 'change',
    kind: item.kind,
    effort: item.effort,
    ...(item.impact ? { impact: item.impact } : {}),
    ...(item.consequence ? { consequence: item.consequence } : {}),
    destination: { kind: 'code', pull: item.layer },
    resolution: 'agreed',
    raisedBy: ['stack'],
  }
  const decided = triage(resolved)
  return {
    id: item.id,
    layer: item.layer,
    title: item.title,
    kind: item.kind,
    effort: item.effort,
    ...(item.impact ? { impact: item.impact } : {}),
    ...(item.consequence ? { consequence: item.consequence } : {}),
    verdict: 'legit',
    resolution: 'agreed',
    disposition: decided.disposition,
    rank: decided.rank,
    triage: decided.reason,
    followUp: decided.followUp,
    reason: item.plan,
    plan: item.plan,
    evidence: [],
    destination: { pull: item.layer },
    origin: 'change',
    raisedBy: [],
  }
}

function passLimitations({ pass }: StackReviewSession): string[] {
  if (pass?.outcome === 'single')
    return ['Only one provider was available, so no second model checked the cross-layer pass.']
  if (pass?.outcome === 'exhausted')
    return [
      `The two models did not agree on the cross-layer pass within ${String(pass.turns.length)} turns. The last valid result is kept; what the second model did not approve is a decision, not a fix.`,
    ]
  return []
}
