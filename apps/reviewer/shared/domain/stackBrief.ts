import type { ResolvedEntry } from './grounding'
import type {
  CrossLayerResult,
  StackEntry,
  StackPassInput,
  StackReviewSession,
} from './stackReview'
import { triage } from './triage'

/**
 * The stack brief: one place to work a whole stack from, for a person or a coding agent. Its
 * structure is what an agent applies, so every item keeps its entry id and its layer.
 */
export interface StackBrief {
  layers: BriefLayer[]
  summary?: string
  /** One queue across the stack: questions for the author and proposals to reshape the stack. */
  decisions: BriefDecision[]
  /** Bottom to top, each layer's fixes in triage order. */
  fixes: { layer: BriefLayer; items: BriefFix[] }[]
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
export interface BriefDecision {
  id: string
  layer: number
  title: string
  question: string
  recommendation?: string
  cost?: string
  why: string
  contested: boolean
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
    decisions: [
      // A question stays even when a chain would make it unnecessary: that change is not settled.
      ...unmerged
        .filter(
          (entry) =>
            entry.disposition === 'ask' || (entry.disposition === 'fix' && doubts.has(entry.id)),
        )
        .map((entry) => decision(entry, doubts.get(entry.id), entryContested(entry.id, contested))),
      ...derived
        .filter(({ item, entry }) => entry.disposition === 'fix' && doubts.has(item.id))
        .map(({ entry }) => decision(entry, doubts.get(entry.id), true)),
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
 * What a conclusion the second model did not approve leaves for the author to decide, by the
 * entry it would have changed: which layer a moved change belongs on, whether a change a chain
 * would retire or a duplicate would absorb is still to be made, and whether to make a derived one.
 */
function contestedDoubts(
  result: CrossLayerResult,
  contested: ReadonlySet<string>,
  plan: ReturnType<typeof placement>,
): Map<string, string[]> {
  const doubts = new Map<string, string[]>()
  const add = (id: string, doubt: string) => doubts.set(id, [...(doubts.get(id) ?? []), doubt])
  const named = (id: string) => `${id} (${plan.title(id)})`
  const unapproved = 'The second model did not approve that.'
  for (const item of result.ownership)
    if (contested.has(`ownership ${item.entry}`)) {
      const entry = plan.entry(item.entry)
      const from = entry?.destination?.pull ?? entry?.layer
      add(
        item.entry,
        `Which layer does this change belong on: PR #${String(from)}, where its panel put it, or PR #${String(item.layer)}, where the cross-layer pass moved it? ${item.reason} ${unapproved}`,
      )
    }
  for (const chain of result.chains)
    if (contested.has(`chain ${chain.cause}`))
      for (const id of chain.unnecessary)
        add(
          id,
          `${named(chain.cause)} may make this unnecessary: ${chain.reason} ${unapproved} Still make this change?`,
        )
  for (const group of result.duplicates)
    if (contested.has(`duplicate ${group.owner}`))
      for (const id of group.entries.filter((other) => other !== group.owner))
        add(
          id,
          `This may repeat ${named(group.owner)}: ${group.reason} ${unapproved} Make it separately?`,
        )
  for (const item of result.derived)
    if (contested.has(`derived ${item.id}`))
      add(
        item.id,
        `Only the whole stack shows this, derived from ${item.from.join(', ')}. The second model did not approve it. Make this change?`,
      )
  return doubts
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

/** Whether the other model did not approve a conclusion the entry leads. */
function entryContested(id: string, contested: ReadonlySet<string>): boolean {
  return ['duplicate', 'ownership', 'chain'].some((kind) => contested.has(`${kind} ${id}`))
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

/** An entry for the author: its own question when triage asks one, then any doubts about it. */
function decision(
  entry: StackEntry,
  doubts: readonly string[] = [],
  contested = false,
): BriefDecision {
  const asked = entry.disposition === 'ask'
  return {
    id: entry.id,
    layer: entry.layer,
    title: entry.title,
    question: [...(asked ? [decisionQuestion(entry)] : []), ...doubts].join(' '),
    ...(entry.plan ? { recommendation: entry.plan } : {}),
    ...(entry.effort ? { cost: entry.effort } : {}),
    why: asked ? entry.triage : 'The second model did not approve a conclusion about it.',
    contested: contested || doubts.length > 0,
  }
}

function decisionQuestion(entry: StackEntry): string {
  if (entry.question) return entry.question
  if (entry.verdict === 'predicted' && entry.resolution === 'agreed')
    return `The reviewer will likely ask for this, though both models would leave the code as it is. Make the change, or keep the code and reply: ${entry.reason}`
  return 'The two models disagree on this. Which position should be taken?'
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
