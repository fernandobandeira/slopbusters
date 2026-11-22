import { bulkDefaults } from './projectStackBrief'
import type { StackBrief } from './stackBrief'
import { layerMoved } from './stackBriefLayers'
import { remainingBudgetNote, unreadBudgetNote } from './stackPassInput'
import type { BriefDecision, BriefDecisionGroup } from './stackDecisions'
import type { GroundingKind } from './grounding'

const decisionGroups: readonly {
  id: BriefDecisionGroup
  label: string
}[] = [
  { id: 'opposed', label: 'Reviewers ask for opposite things' },
  { id: 'disputed', label: 'The two models disagree' },
  { id: 'openQuestion', label: 'Your call' },
  { id: 'crossLayer', label: 'Cross-layer decisions' },
  { id: 'reversal', label: 'Would undo an earlier round' },
  {
    id: 'predicted',
    label: 'A reviewer will probably ask, the models would not',
  },
]

export function groupDecisions(brief: StackBrief) {
  return decisionGroups
    .map((group) => {
      const decisions = brief.decisions.filter(({ group: id }) => id === group.id)
      return { ...group, decisions, defaults: bulkDefaults(brief, decisions) }
    })
    .filter((group) => group.decisions.length)
}

export function briefCounts(brief: StackBrief) {
  const hasDefault = bulkDefaults(brief, brief.decisions).length
  return {
    serious: brief.serious.filter(
      ({ disposition }) => !disposition || disposition.state === 'assigned',
    ).length,
    answered: brief.review?.answered.length ?? 0,
    total: brief.decisions.length + (brief.review?.answered.length ?? 0),
    needsAnswer: brief.decisions.length - hasDefault,
    hasDefault,
    fixes: brief.fixes.reduce(
      (total, group) => total + group.items.filter(({ applied }) => !applied).length,
      0,
    ),
    unread: brief.unread.length,
    moved: brief.layers.filter(layerMoved).length,
  }
}

export function reviewLimitations(brief: StackBrief): string[] {
  return brief.limitations.filter((note) => !note.startsWith(unreadBudgetNote))
}

export function stripCounts(brief: StackBrief): string {
  const { serious, answered, total, needsAnswer, fixes, unread, moved } = briefCounts(brief)
  return [
    brief.review && total && `${answered} of ${total} answered`,
    serious && `${serious} serious ${plural(serious, 'consequence')}`,
    needsAnswer &&
      `${needsAnswer} ${plural(needsAnswer, 'question')} need${needsAnswer === 1 ? 's' : ''} you`,
    fixes && `${fixes} ${plural(fixes, 'fix', 'fixes')} ready`,
    unread && `${unread} ${plural(unread, 'entry', 'entries')} not read`,
    moved &&
      `${moved} ${plural(moved, 'layer')} moved since ${moved === 1 ? 'its panel' : 'their panels'}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function reviewLead(brief: StackBrief): string {
  const { answered, total, needsAnswer, hasDefault: defaults, fixes } = briefCounts(brief)
  const sentences = [
    brief.review && total && `${answered} of ${total} answered.`,
    needsAnswer && `${needsAnswer} ${needsAnswer === 1 ? 'question needs' : 'questions need'} you.`,
    defaults &&
      `${defaults} ${needsAnswer ? 'more' : plural(defaults, 'question')} ${defaults === 1 ? 'has' : 'have'} a default.`,
    fixes && `${fixes} ${fixes === 1 ? 'fix is' : 'fixes are'} ready.`,
  ].filter(Boolean)
  return sentences.join(' ') || 'There are no questions or fixes ready.'
}

export function coverageWarnings(brief: StackBrief): string[] {
  const unread = brief.unread.length
  return [
    ...(unread
      ? [`The cross-layer pass did not read ${unread} ${plural(unread, 'entry', 'entries')}.`]
      : []),
    ...reviewLimitations(brief).filter((note) => note !== remainingBudgetNote),
    ...(brief.stale.length
      ? ['Some findings may be stale. See Review notes for the revisions involved.']
      : []),
  ]
}

export function briefOnLayer(brief: StackBrief, layer: number | undefined): StackBrief {
  if (layer === undefined) return brief
  const belongs = (item: { layer: number }) => item.layer === layer
  const onLayer = (item: BriefDecision) =>
    belongs(item) ||
    item.options.some(({ change }) => change?.layer === layer || change?.structure?.into === layer)
  return {
    ...brief,
    layers: brief.layers.filter((item) => item.number === layer),
    serious: brief.serious.filter(belongs),
    decisions: brief.decisions.filter(onLayer),
    review: brief.review && {
      ...brief.review,
      answered: brief.review.answered.filter(({ decision }) => onLayer(decision)),
      history: brief.review.history.filter(({ snapshot }) =>
        snapshot.layers.some(({ pull }) => pull === layer),
      ),
    },
    fixes: brief.fixes.filter((group) => group.layer.number === layer),
    unread: brief.unread.filter(belongs),
    followUps: brief.followUps.filter(belongs),
    chains: brief.chains
      .map((chain) =>
        belongs(chain.cause)
          ? chain
          : {
              ...chain,
              unnecessary: chain.unnecessary.filter(belongs),
            },
      )
      .filter((chain) => chain.unnecessary.length),
  }
}

export function unreadByLayer(brief: StackBrief) {
  const groups = new Map<number, StackBrief['unread']>()
  for (const item of brief.unread) {
    const group = groups.get(item.layer) ?? []
    group.push(item)
    groups.set(item.layer, group)
  }
  return [...groups].sort(([a], [b]) => a - b)
}

const fixKinds: Record<GroundingKind | 'unclassified', [string, string]> = {
  rule: ['rule', 'rules'],
  simplification: ['simplification', 'simplifications'],
  test: ['test', 'tests'],
  wording: ['wording fix', 'wording fixes'],
  defect: ['defect', 'defects'],
  product: ['product fix', 'product fixes'],
  edgeCase: ['edge case', 'edge cases'],
  unclassified: ['unclassified fix', 'unclassified fixes'],
}

export function fixKindSummary(brief: StackBrief): string {
  const counts = new Map<keyof typeof fixKinds, number>()
  for (const { items } of brief.fixes)
    for (const item of items.filter(({ applied }) => !applied)) {
      const kind = item.kind ?? 'unclassified'
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  return [...counts]
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${plural(count, ...fixKinds[kind])}`)
    .join(' · ')
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}
