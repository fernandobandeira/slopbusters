import { z } from 'zod'
import { isSerious } from './impact'
import type { CrossLayerResult, StackEntry } from './stackReview'

export type BriefDecisionGroup =
  'opposed' | 'disputed' | 'openQuestion' | 'crossLayer' | 'reversal' | 'predicted'

export const decisionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  recommended: z.boolean(),
  reply: z.string().optional(),
  change: z
    .object({
      layer: z.number(),
      plan: z.string(),
      unresolvedDestination: z.literal(true).optional(),
      field: z.enum(['title', 'description']).optional(),
      structure: z
        .object({
          action: z.enum(['drop', 'fold', 'split']),
          into: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})
export type BriefDecisionOption = z.infer<typeof decisionOptionSchema>

/**
 * The stack brief's decision queue: an entry triage puts to the author, with what makes it the
 * author's: its own question, a cross-layer conclusion the second model did not approve, an
 * earlier round's request its plan would undo, or another finding that asks the opposite.
 */
export interface BriefDecision {
  id: string
  layer: number
  title: string
  question: string
  recommendation?: string
  cost?: string
  why: string
  contested: boolean
  group: BriefDecisionGroup
  options: BriefDecisionOption[]
  reason: string
  kind?: StackEntry['kind']
  crossLayerQuestion?: string
  evidence: StackEntry[]
  relatedEntries?: string[]
  relatedLayers?: number[]
}

interface Doubt {
  text: string
  proposedLayer?: number
  relatedEntries?: string[]
}
interface Lookup {
  entry: (id: string) => StackEntry | undefined
}

/**
 * One decision per entry, in order, except that entries asking for opposite changes are one
 * decision naming every side.
 */
export function entryDecisions(
  entries: readonly StackEntry[],
  {
    doubts,
    contested,
    entry: find,
    layerOf,
  }: Lookup & {
    doubts: ReadonlyMap<string, Doubt[]>
    contested: ReadonlySet<string>
    layerOf: (entry: StackEntry) => number
  },
): BriefDecision[] {
  const decided = new Set<string>()
  return entries.flatMap((entry) => {
    if (decided.has(entry.id)) return []
    decided.add(entry.id)
    if (!entry.opposes)
      return [
        decision(entry, layerOf(entry), doubts.get(entry.id), entryContested(entry.id, contested)),
      ]
    const sides: [StackEntry, ...StackEntry[]] = [
      entry,
      ...[...new Set(entry.opposes.entries)]
        .filter((id) => id !== entry.id)
        .flatMap((id) => find(id) ?? []),
    ]
    for (const side of sides) decided.add(side.id)
    return [conflict(sides, entry.opposes.reason, layerOf, doubts)]
  })
}

/**
 * What a conclusion the second model did not approve leaves for the author to decide, by the
 * entry it would have changed: which layer a moved change belongs on, whether a change a chain
 * would retire or a duplicate would absorb is still to be made, and whether to make a derived one.
 */
export function contestedDoubts(
  result: CrossLayerResult,
  contested: ReadonlySet<string>,
  plan: Lookup & { title: (id: string) => string },
): Map<string, Doubt[]> {
  const doubts = new Map<string, Doubt[]>()
  const add = (id: string, doubt: Doubt) => doubts.set(id, [...(doubts.get(id) ?? []), doubt])
  const named = (id: string) => `${id} (${plan.title(id)})`
  const unapproved = 'The second model did not approve that.'
  for (const item of result.ownership)
    if (contested.has(`ownership ${item.entry}`)) {
      const entry = plan.entry(item.entry)
      const from = entry?.destination?.pull ?? entry?.layer
      add(item.entry, {
        text: `Which layer does this change belong on: PR #${String(from)}, where its panel put it, or PR #${String(item.layer)}, where the cross-layer pass moved it? ${item.reason} ${unapproved}`,
        proposedLayer: item.layer,
      })
    }
  for (const chain of result.chains)
    if (contested.has(`chain ${chain.cause}`))
      for (const id of chain.unnecessary)
        add(id, {
          text: `${named(chain.cause)} may make this unnecessary: ${chain.reason} ${unapproved} Still make this change?`,
          relatedEntries: [chain.cause],
        })
  for (const group of result.duplicates)
    if (contested.has(`duplicate ${group.owner}`))
      for (const id of group.entries.filter((other) => other !== group.owner))
        add(id, {
          text: `This may repeat ${named(group.owner)}: ${group.reason} ${unapproved} Make it separately?`,
          relatedEntries: [group.owner],
        })
  for (const item of result.derived)
    if (contested.has(`derived ${item.id}`))
      add(item.id, {
        text: `Only the whole stack shows this, derived from ${item.from.join(', ')}. The second model did not approve it. Make this change?`,
        relatedEntries: item.from,
      })
  return doubts
}

/** Whether the other model did not approve a conclusion the entry leads. */
function entryContested(id: string, contested: ReadonlySet<string>): boolean {
  return ['duplicate', 'ownership', 'chain'].some((kind) => contested.has(`${kind} ${id}`))
}

/** An entry for the author: its own question when triage asks one, then any doubts about it. */
function decision(
  entry: StackEntry,
  layer: number,
  doubts: readonly Doubt[] = [],
  contested = false,
): BriefDecision {
  const asked = entry.disposition === 'ask' || entry.disposition === 'prepare'
  const group = decisionGroup(entry, doubts.length > 0)
  const crossLayerQuestion = doubts.map(({ text }) => text).join(' ')
  return {
    id: entry.id,
    layer: entry.layer,
    title: entry.title,
    question: [asked ? decisionQuestion(entry) : '', crossLayerQuestion].filter(Boolean).join(' '),
    ...(entry.plan ? { recommendation: entry.plan } : {}),
    ...(entry.effort ? { cost: entry.effort } : {}),
    why: asked ? entry.triage : 'The second model did not approve a conclusion about it.',
    contested: contested || doubts.length > 0,
    group,
    options: decisionOptions(entry, layer, group, doubts),
    reason: entry.reason,
    kind: entry.kind,
    crossLayerQuestion,
    evidence: [entry],
    relatedEntries: doubts.flatMap((doubt) => doubt.relatedEntries ?? []),
  }
}

function decisionGroup(entry: StackEntry, hasDoubts: boolean): BriefDecisionGroup {
  if (entry.resolution === 'disputed') return 'disputed'
  if (entry.question) return 'openQuestion'
  if (hasDoubts) return 'crossLayer'
  if (entry.reverses) return 'reversal'
  if (entry.verdict === 'predicted' && entry.resolution === 'agreed') return 'predicted'
  return 'openQuestion'
}

function decisionOptions(
  entry: StackEntry,
  layer: number,
  group: BriefDecisionGroup,
  doubts: readonly Doubt[],
): BriefDecisionOption[] {
  const otherLayers = [
    ...new Set(doubts.flatMap(({ proposedLayer }) => proposedLayer ?? [])),
  ].filter((proposed) => proposed !== layer)
  const serious = isSerious(entry)
  const keep = { id: 'keep', label: 'Leave the code as it is', recommended: false }
  if (otherLayers.length)
    return [
      ...[layer, ...otherLayers].flatMap((pull) =>
        changeOption(entry, pull, {
          id: `layer-${pull}`,
          label: `Make the change on PR #${pull}`,
          knownDestination: pull !== layer || Boolean(entry.destination),
        }),
      ),
      keep,
    ]
  if (group === 'predicted')
    return [
      { ...keep, label: 'Keep the code and reply', recommended: !serious, reply: entry.reason },
      ...changeOption(entry, layer),
    ]
  return [
    ...changeOption(entry, layer),
    {
      ...keep,
      recommended: group === 'reversal' && entry.kind !== 'defect' && !serious,
      ...(entry.verdict === 'predicted' ? { reply: entry.reason } : {}),
    },
  ]
}

function changeOption(
  entry: StackEntry,
  layer: number,
  {
    id = 'change',
    label = 'Make the change',
    knownDestination = Boolean(entry.destination) || layer !== entry.layer,
  } = {},
): BriefDecisionOption[] {
  if (!entry.plan?.trim()) return []
  return [
    {
      id,
      label,
      detail: entry.plan,
      recommended: false,
      change: {
        layer,
        plan: entry.plan,
        field: entry.destination?.field,
        ...(knownDestination ? {} : { unresolvedDestination: true as const }),
      },
    },
  ]
}

function decisionQuestion(entry: StackEntry): string {
  if (entry.reverses) {
    const argument =
      entry.verdict === 'predicted'
        ? `The models would not ask for it; reply if the code stays: ${entry.reason}`
        : `This round's reason: ${entry.reason}`
    return `${reversal(entry.reverses)} ${argument} Undo the earlier change, or keep it?`
  }
  if (entry.question) return entry.question
  // Stack reviews saved before predictions were prepared put agreed ones to the author.
  if (entry.verdict === 'predicted' && entry.resolution === 'agreed')
    return `The reviewer will likely ask for this, though both models would leave the code as it is. Make the change, or keep the code and reply: ${entry.reason}`
  return 'The two models disagree on this. Which position should be taken?'
}

/** Findings whose plans cannot both be applied: one question, which one, if either. */
function conflict(
  sides: [StackEntry, ...StackEntry[]],
  reason: string,
  layerOf: (entry: StackEntry) => number,
  doubts: ReadonlyMap<string, Doubt[]>,
): BriefDecision {
  const [first] = sides
  return {
    id: `opposed:${[...new Set(sides.map(({ id }) => id))].sort().join('+')}`,
    layer: first.layer,
    title: `Opposed changes: ${sides.map((side) => side.title).join(' / ')}`,
    question: `These ask for opposite changes: ${reason} Which one, if either? ${sides.map(sideLine).join(' ')}`,
    recommendation: 'None: the panel does not judge which side is right.',
    why: 'Another finding asks for the opposite change.',
    contested: false,
    group: 'opposed',
    options: [
      ...sides.flatMap((side) =>
        changeOption(side, layerOf(side), { id: side.id, label: side.title }),
      ),
      { id: 'neither', label: 'Make neither change', recommended: false },
    ],
    reason,
    kind: first.kind,
    crossLayerQuestion: sides
      .flatMap((side) => doubts.get(side.id)?.map(({ text }) => text) ?? [])
      .join(' '),
    evidence: sides,
    relatedEntries: sides.flatMap(
      (side) => doubts.get(side.id)?.flatMap((doubt) => doubt.relatedEntries ?? []) ?? [],
    ),
  }
}

export function structureDecisions(
  proposals: CrossLayerResult['structure'],
  contested: ReadonlySet<string>,
): BriefDecision[] {
  const occurrences = new Map<string, number>()
  return proposals.map((item) => {
    const key = `structure:${item.layer}:${item.action}:${item.into ?? ''}`
    const seen = occurrences.get(key) ?? 0
    occurrences.set(key, seen + 1)
    return structureDecision(
      item,
      seen ? `${key}:${seen + 1}` : key,
      contested.has(`structure #${item.layer}`),
    )
  })
}

function structureDecision(
  item: CrossLayerResult['structure'][number],
  id: string,
  contested: boolean,
): BriefDecision {
  const title = structureTitle(item)
  return {
    id,
    layer: item.layer,
    title,
    question: `${title}?`,
    recommendation: item.reason,
    cost: item.cost,
    why: 'Only the whole stack shows this.',
    contested,
    group: 'crossLayer',
    options: [
      {
        id: item.action,
        label: title,
        recommended: false,
        change: {
          layer: item.layer,
          plan: `${title}. ${item.reason}`,
          structure: { action: item.action, into: item.into },
        },
      },
      { id: 'keep-stack', label: 'Keep the stack as it is', recommended: false },
    ],
    reason: item.reason,
    evidence: [],
  }
}

function sideLine(side: StackEntry): string {
  const raisedBy = side.raisedBy.length ? `, raised by ${side.raisedBy.join(', ')}` : ''
  const reverses = side.reverses ? ` ${reversal(side.reverses)}` : ''
  return `${side.id} (${side.title}${raisedBy}): ${side.plan ?? 'No plan recorded.'}${reverses}`
}

/** The earlier request a plan would undo, beside this round's reason, as one passage. */
function reversal({ request, reason }: NonNullable<StackEntry['reverses']>): string {
  return `It would undo what the round of ${request.round} asked for in ${request.entry}, "${request.title}": ${request.plan} (${request.reason}) The check found: ${reason}`
}

function structureTitle(item: CrossLayerResult['structure'][number]): string {
  const layer = `PR #${String(item.layer)}`
  if (item.action === 'fold') return `Fold ${layer} into PR #${String(item.into ?? 0)}`
  return `${item.action === 'drop' ? 'Drop' : 'Split'} ${layer}`
}
