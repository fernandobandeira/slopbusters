import { type ResolvedEntry } from './grounding'
import { isSerious } from './impact'
import type {
  CrossLayerResult,
  StackEntry,
  StackPassInput,
  StackReviewSession,
} from './stackReview'
import { contestedDoubts, entryDecisions, type BriefDecision } from './stackDecisions'
import { triage } from './triage'

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
  /** What a reviewer will likely ask though the models would not: replies to have ready. */
  predictions: BriefPrediction[]
  chains: BriefChain[]
  /** Entries triage left for later: problems already there, or cases needing several failures. */
  followUps: BriefFollowUp[]
  stale: BriefStale[]
  limitations: string[]
}
export interface BriefLayer {
  number: number
  title: string
  url: string
  reviewedHead?: string
  currentHead?: string
  reviewedBase?: string
  currentBase?: string
  /** False when the layer's head or base moved since its panel reviewed it. */
  current: boolean
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
}
export interface BriefPrediction {
  id: string
  layer: number
  title: string
  /** The change that would answer the reviewer, should the author choose to make it. */
  plan?: string
  effort?: StackEntry['effort']
  /** The models' argument for keeping the code, written to send as the reply. */
  reply: string
}
export interface BriefChain {
  cause: { id: string; title: string }
  reason: string
  unnecessary: { id: string; title: string }[]
}
export interface BriefFollowUp {
  id: string
  layer: number
  title: string
  triage: string
}
export interface BriefStale {
  layer: number
  entries: string[]
  reason: string
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
              entry.disposition === 'ask' || (entry.disposition === 'fix' && doubts.has(entry.id)),
          ),
          ...derived
            .filter(
              ({ item, entry }) =>
                entry.disposition === 'ask' || (entry.disposition === 'fix' && doubts.has(item.id)),
            )
            .map(({ entry }) => entry),
        ],
        { doubts, contested, entry: plan.entry },
      ),
      ...result.structure.map((item) => ({
        id: `#${String(item.layer)}`,
        layer: item.layer,
        title: structureTitle(item),
        question: `${structureTitle(item)}?`,
        recommendation: item.reason,
        cost: item.cost,
        why: 'Only the whole stack shows this.',
        contested: contested.has(`structure #${String(item.layer)}`),
      })),
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
    predictions: predictionsOf(current),
    chains: result.chains.map((chain) => ({
      cause: { id: chain.cause, title: plan.title(chain.cause) },
      reason: chain.reason,
      unnecessary: chain.unnecessary.map((id) => ({ id, title: plan.title(id) })),
    })),
    followUps: [...current, ...derived.map(({ entry }) => entry)]
      .filter((entry) => entry.followUp)
      .map((entry) => ({
        id: entry.id,
        layer: entry.layer,
        title: entry.title,
        triage: entry.triage,
      })),
    stale: staleEntries(input, layers),
    limitations: [...input.limitations, ...passLimitations(session)],
  }
}

/** Predicted reviewer comments, bottom to top, each with the reply to give. */
function predictionsOf(entries: readonly StackEntry[]): BriefPrediction[] {
  return entries
    .filter((entry) => entry.disposition === 'prepare')
    .sort((a, b) => a.layer - b.layer || a.rank - b.rank)
    .map((entry) => ({
      id: entry.id,
      layer: entry.layer,
      title: entry.title,
      ...(entry.plan ? { plan: entry.plan } : {}),
      ...(entry.effort ? { effort: entry.effort } : {}),
      reply: entry.reason,
    }))
}

interface Standing {
  plan: ReturnType<typeof placement>
  doubts: ReadonlyMap<string, string[]>
  result: CrossLayerResult
}

/**
 * Each serious entry with where the brief puts it, including one merged into a duplicate: the
 * owner of a group may not carry the serious consequence itself.
 */
function seriousEntries(entries: readonly StackEntry[], standing: Standing): BriefSerious[] {
  return entries.filter(isSerious).map((entry) => ({
    id: entry.id,
    layer: entry.layer,
    title: entry.title,
    impact: entry.impact,
    consequence: entry.consequence ?? entry.reason,
    contested: entry.impactContested ?? false,
    standing: seriousStanding(entry, standing),
  }))
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

function briefLayers(session: StackReviewSession, input: StackPassInput): BriefLayer[] {
  return session.layers.map((layer) => {
    const reviewed = input.layers.find((item) => item.number === layer.number)
    return {
      number: layer.number,
      title: layer.title,
      url: layer.url,
      ...(reviewed
        ? { reviewedHead: reviewed.reviewedHead, reviewedBase: reviewed.reviewedBase }
        : {}),
      ...(layer.headSha ? { currentHead: layer.headSha } : {}),
      ...(layer.baseSha ? { currentBase: layer.baseSha } : {}),
      current: Boolean(
        reviewed &&
        layer.headSha === reviewed.reviewedHead &&
        layer.baseSha === reviewed.reviewedBase,
      ),
    }
  })
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
    merged: (id: string) => merged.has(id),
    unnecessary: (id: string) => unnecessary.has(id),
    title: (id: string) => byId.get(id)?.title ?? id,
    moved: (id: string) => moved.get(id),
    alsoRaised: (id: string) =>
      result.duplicates
        .filter((group) => group.owner === id)
        .flatMap((group) => group.entries.filter((other) => other !== id)),
    layerOf(entry: StackEntry): number {
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

/**
 * Entries that may no longer hold: every entry of a layer that moved since its panel, and each
 * entry settled by a layer whose head is not the one its grounding read.
 */
function staleEntries(input: StackPassInput, layers: readonly BriefLayer[]): BriefStale[] {
  const heads = new Map(layers.map((layer) => [layer.number, layer.currentHead]))
  const moved = layers
    .filter((layer) => layer.reviewedHead && layer.currentHead && !layer.current)
    .map((layer) => ({
      layer: layer.number,
      entries: input.entries
        .filter((entry) => entry.layer === layer.number)
        .map((entry) => entry.id),
      reason: movedReason(layer),
    }))
  const settled = input.entries.flatMap((entry) => {
    const layer = entry.settledBy
    const read = input.layers
      .find((item) => item.number === entry.layer)
      ?.read.find((item) => item.pull === layer)?.headSha
    const now = layer === undefined ? undefined : heads.get(layer)
    if (layer === undefined || !read || !now || read === now) return []
    return [
      {
        layer,
        entries: [entry.id],
        reason: `Settled by PR #${String(layer)} at \`${short(read)}\`, which is at \`${short(now)}\` now.`,
      },
    ]
  })
  return [...moved, ...settled]
}

function movedReason(layer: BriefLayer): string {
  const name = `PR #${String(layer.number)}`
  if (layer.currentHead !== layer.reviewedHead)
    return `${name} moved since its panel reviewed \`${short(layer.reviewedHead)}\`; it is at \`${short(layer.currentHead)}\` now.`
  return `${name}'s base moved since its panel reviewed it on \`${short(layer.reviewedBase)}\`; it is on \`${short(layer.currentBase)}\` now, so its diff may differ.`
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

function structureTitle(item: CrossLayerResult['structure'][number]): string {
  const layer = `PR #${String(item.layer)}`
  if (item.action === 'fold') return `Fold ${layer} into PR #${String(item.into ?? 0)}`
  return `${item.action === 'drop' ? 'Drop' : 'Split'} ${layer}`
}

export function short(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : 'unknown'
}
