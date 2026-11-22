import { expect, it } from 'vitest'
import { projectStackBrief, bulkDefaults } from '../../../shared/domain/projectStackBrief'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import { decisionSnapshot } from '../../../shared/domain/stackDecisionSnapshot'
import { structureDecisions } from '../../../shared/domain/stackDecisions'
import { stackDecisionRecord } from '../../fixtures/stackDecisionRecord'
import { finishedStackReview, stackEntry } from '../../fixtures/stackReview'

function example() {
  return stackBrief(
    finishedStackReview([
      stackEntry(201, 'code', { disposition: 'ask', destination: { pull: 202 } }),
      stackEntry(201, 'metadata', {
        disposition: 'ask',
        destination: { pull: 202, field: 'title' },
      }),
      stackEntry(202, 'reply', { disposition: 'ask', verdict: 'predicted' }),
      stackEntry(201, 'open', { disposition: 'ask' }),
      stackEntry(201, 'serious', { disposition: 'ask', verdict: 'predicted', impact: 'money' }),
    ]),
  )!
}

it('moves records to Answered and produces only chosen code fixes with frozen provenance', () => {
  const brief = example()
  const [code, metadata, reply, open, serious] = brief.decisions
  const projection = projectStackBrief(brief, 'stack-1', [
    stackDecisionRecord(brief, code!, {
      state: 'chosen',
      optionId: 'change',
      note: 'Retain compatibility.',
    }),
    stackDecisionRecord(brief, metadata!, { state: 'chosen', optionId: 'change' }),
    stackDecisionRecord(brief, reply!, {
      state: 'chosen',
      optionId: 'keep',
      reply: 'The limit is documented.',
    }),
    stackDecisionRecord(brief, open!, { state: 'leftOpen', note: 'Discuss tomorrow.' }),
  ])
  expect(projection.decisions).toEqual([serious])
  expect(projection.review?.answered.map(({ manual }) => manual)).toEqual([
    false,
    true,
    false,
    false,
  ])
  expect(projection.fixes).toMatchObject([
    {
      layer: { number: 202 },
      items: [
        {
          id: 'decision:#201/code:change',
          plan: 'Fix code.',
          decision: {
            sessionId: 'stack-1',
            decisionId: '#201/code',
            revision: 1,
            note: 'Retain compatibility.',
          },
        },
      ],
    },
  ])
  expect(projection.serious).toHaveLength(1)
  const markdown = stackBriefMarkdown(projection, 'example/repository')
  for (const label of [
    "The author's decisions",
    'Manual work for the author',
    'Private note: Discuss tomorrow.',
    'Reply ready: The limit is documented.',
    'Author decision: #201/code',
    '`change`: Make the change',
  ])
    expect(markdown).toContain(label)
})

it.each(['currentHead', 'currentBase'] as const)(
  'rechecks a changed %s until confirmed',
  (field) => {
    const brief = example()
    const decision = brief.decisions[0]!
    const record = stackDecisionRecord(brief, decision, { state: 'chosen', optionId: 'change' })
    brief.layers[1]![field] = 'moved'
    const stale = projectStackBrief(brief, 'stack-1', [record])
    expect(stale.review?.answered[0]?.recheck).toBe(true)
    expect(stale.fixes).toEqual([])
    record.snapshot = decisionSnapshot(brief, decision, true)
    const confirmed = projectStackBrief(brief, 'stack-1', [record])
    expect(confirmed.review?.answered[0]?.recheck).toBe(false)
    expect(confirmed.fixes).toHaveLength(1)
  },
)

it.each(['none', 'question', 'option', 'head', 'base'] as const)(
  'carries the answer only when %s changed',
  (change) => {
    const brief = example()
    const decision = brief.decisions[0]!
    const record = stackDecisionRecord(brief, decision, { state: 'chosen', optionId: 'change' })
    record.snapshot = structuredClone(record.snapshot)
    if (change === 'question') decision.question = 'Different question?'
    if (change === 'option') decision.options[0]!.change!.plan = 'A different effect.'
    if (change === 'head') brief.layers[1]!.reviewedHead = brief.layers[1]!.currentHead = 'new-head'
    if (change === 'base') brief.layers[1]!.reviewedBase = brief.layers[1]!.currentBase = 'new-base'
    const result = projectStackBrief(brief, 'stack-2', [record])
    expect(result.review?.answered).toHaveLength(change === 'none' ? 1 : 0)
    expect(result.review?.history).toHaveLength(change === 'none' ? 0 : 1)
    expect(result.fixes).toHaveLength(change === 'none' ? 1 : 0)
  },
)

it('keeps structure and a change without a plan as manual work', () => {
  const brief = example()
  const decision = brief.decisions[0]!
  decision.options[0]!.change!.plan = ''
  const restructure = { layer: 201, reason: 'Separate the feature.', cost: 'One rebase.' }
  const [split, drop] = structureDecisions(
    [
      { ...restructure, action: 'split' },
      { ...restructure, action: 'drop' },
    ],
    new Set(),
  )
  expect(split!.id).not.toBe(drop!.id)
  brief.decisions.push(split!, drop!)
  const result = projectStackBrief(brief, 'stack-1', [
    stackDecisionRecord(brief, decision, { state: 'chosen', optionId: 'change' }),
    stackDecisionRecord(brief, split!, { state: 'chosen', optionId: 'split' }),
  ])
  expect(result.review?.answered.map(({ manual }) => manual)).toEqual([true, true])
  expect(result.fixes).toEqual([])
})

it('offers no bulk defaults for answered, stale, or serious cards', () => {
  const brief = example()
  const [, , reply] = brief.decisions
  const result = projectStackBrief(brief, 'stack-1', [])
  expect(bulkDefaults(result, result.decisions).map(({ decisionId }) => decisionId)).toEqual([
    reply?.id,
  ])
  const answered = projectStackBrief(brief, 'stack-1', [
    stackDecisionRecord(brief, reply!, { state: 'chosen', optionId: 'keep' }),
  ])
  expect(bulkDefaults(answered, answered.decisions)).toEqual([])
  brief.layers[1]!.currentHead = 'moved'
  const stale = projectStackBrief(brief, 'stack-1', [])
  expect(bulkDefaults(stale, stale.decisions)).toEqual([])
})

it('excludes applied plans from the markdown fix list while retaining the decision', () => {
  const brief = example()
  const record = stackDecisionRecord(brief, brief.decisions[0]!, {
    state: 'chosen',
    optionId: 'change',
  })
  const projection = projectStackBrief(brief, 'stack-1', [record], ['decision:#201/code:change'])
  expect(projection.fixes[0]?.items[0]).toMatchObject({ applied: true })
  const markdown = stackBriefMarkdown(projection, 'example/repository')
  expect(markdown).toContain("The author's decisions")
  expect(markdown).not.toContain('decision:#201/code:change')
})
