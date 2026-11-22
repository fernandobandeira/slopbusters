import type { StackBrief } from './stackBrief'
import { layerMoved } from './stackBriefLayers'
import { remainingBudgetNote, unreadBudgetNote } from './stackPassInput'
import type { BriefDecision, BriefDecisionGroup } from './stackDecisions'
import type { GroundingKind } from './grounding'

const decisionGroups: readonly {
  id: BriefDecisionGroup
  label: string
  hasDefault: boolean
}[] = [
  { id: 'opposed', label: 'Reviewers ask for opposite things', hasDefault: false },
  { id: 'disputed', label: 'The two models disagree', hasDefault: false },
  { id: 'openQuestion', label: 'Your call', hasDefault: false },
  { id: 'crossLayer', label: 'Cross-layer decisions', hasDefault: false },
  { id: 'reversal', label: 'Would undo an earlier round', hasDefault: true },
  {
    id: 'predicted',
    label: 'A reviewer will probably ask, the models would not',
    hasDefault: true,
  },
]

export function groupDecisions(decisions: readonly BriefDecision[]) {
  return decisionGroups
    .map((group) => ({
      ...group,
      decisions: decisions.filter(({ group: id }) => id === group.id),
    }))
    .filter((group) => group.decisions.length)
}

export function briefCounts(brief: StackBrief) {
  const needsAnswer = brief.decisions.filter((decision) => !hasDefault(decision)).length
  return {
    serious: brief.serious.length,
    needsAnswer,
    hasDefault: brief.decisions.length - needsAnswer,
    fixes: brief.fixes.reduce((total, group) => total + group.items.length, 0),
    unread: brief.unread.length,
    moved: brief.layers.filter(layerMoved).length,
  }
}

export function reviewLimitations(brief: StackBrief): string[] {
  return brief.limitations.filter((note) => !note.startsWith(unreadBudgetNote))
}

export function stripCounts(brief: StackBrief): string {
  const { serious, needsAnswer, fixes, unread, moved } = briefCounts(brief)
  return [
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
  const { needsAnswer, hasDefault: defaults, fixes } = briefCounts(brief)
  const sentences = [
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
  return {
    ...brief,
    layers: brief.layers.filter((item) => item.number === layer),
    serious: brief.serious.filter(belongs),
    decisions: brief.decisions.filter(
      (item) =>
        belongs(item) ||
        item.options.some(
          ({ change }) => change?.layer === layer || change?.structure?.into === layer,
        ),
    ),
    fixes: brief.fixes.filter((group) => group.layer.number === layer),
    predictions: brief.predictions.filter(belongs),
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
    for (const item of items) {
      const kind = item.kind ?? 'unclassified'
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
  return [...counts]
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${plural(count, ...fixKinds[kind])}`)
    .join(' · ')
}

function hasDefault(decision: BriefDecision): boolean {
  return (
    (decision.group === 'reversal' || decision.group === 'predicted') &&
    decision.options.some((option) => option.recommended)
  )
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}
