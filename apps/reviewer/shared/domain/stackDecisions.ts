import type { CrossLayerResult, StackEntry } from './stackReview'

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
  }: Lookup & { doubts: ReadonlyMap<string, string[]>; contested: ReadonlySet<string> },
): BriefDecision[] {
  const decided = new Set<string>()
  return entries.flatMap((entry) => {
    if (decided.has(entry.id)) return []
    decided.add(entry.id)
    if (!entry.opposes)
      return [decision(entry, doubts.get(entry.id), entryContested(entry.id, contested))]
    const sides = [entry, ...entry.opposes.entries.flatMap((id) => find(id) ?? [])]
    for (const side of sides) decided.add(side.id)
    return [conflict(sides, entry.opposes.reason)]
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

/** Whether the other model did not approve a conclusion the entry leads. */
function entryContested(id: string, contested: ReadonlySet<string>): boolean {
  return ['duplicate', 'ownership', 'chain'].some((kind) => contested.has(`${kind} ${id}`))
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
  if (entry.reverses) {
    const argument =
      entry.verdict === 'predicted'
        ? `The models would not ask for it; reply if the code stays: ${entry.reason}`
        : `This round's reason: ${entry.reason}`
    return `${reversal(entry.reverses)} ${argument} Undo the earlier change, or keep it?`
  }
  if (entry.question) return entry.question
  return 'The two models disagree on this. Which position should be taken?'
}

/** Findings whose plans cannot both be applied: one question, which one, if either. */
function conflict(sides: readonly StackEntry[], reason: string): BriefDecision {
  const [first] = sides
  return {
    id: first?.id ?? '',
    layer: first?.layer ?? 0,
    title: `Opposed changes: ${sides.map((side) => side.title).join(' / ')}`,
    question: `These ask for opposite changes: ${reason} Which one, if either? ${sides.map(sideLine).join(' ')}`,
    recommendation: 'None: the panel does not judge which side is right.',
    why: 'Another finding asks for the opposite change.',
    contested: false,
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
