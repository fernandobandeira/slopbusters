import { expect, it } from 'vitest'
import { projectStackBrief } from '../../../shared/domain/projectStackBrief'
import { stackBrief } from '../../../shared/domain/stackBrief'
import {
  briefCounts,
  briefOnLayer,
  coverageWarnings,
  groupDecisions,
  reviewLead,
  stripCounts,
} from '../../../shared/domain/stackReviewView'
import { emptyResult, finishedStackReview, stackEntry } from '../../fixtures/stackReview'

function decisionsBrief() {
  return stackBrief(
    finishedStackReview(
      [
        stackEntry(201, 'legacy', { disposition: 'ask', verdict: 'predicted' }),
        stackEntry(201, 'reverse', {
          kind: 'rule',
          disposition: 'ask',
          reverses: {
            request: {
              round: '2026-01-01',
              entry: 'old',
              title: 'Keep the cache',
              plan: 'Use a map.',
              reason: 'Avoid repeated reads.',
              asked: 'fix',
            },
            reason: 'The new plan removes the cache.',
          },
        }),
        stackEntry(201, 'open', {
          disposition: 'ask',
          resolution: 'unverified',
          question: 'Keep the big table?',
          plan: undefined,
        }),
        stackEntry(201, 'disputed', { disposition: 'ask', resolution: 'disputed' }),
        stackEntry(201, 'first', {
          disposition: 'ask',
          raisedBy: ['unclebob@claude', 'unclebob@codex'],
          opposes: { entries: ['#201/second'], reason: 'Both cannot hold.' },
        }),
        stackEntry(201, 'second', {
          disposition: 'ask',
          destination: { pull: 202, field: 'description' },
        }),
      ],
      {
        ...emptyResult,
        structure: [
          {
            action: 'fold',
            layer: 203,
            into: 202,
            reason: 'These layers edit one function.',
            cost: 'One rebase.',
          },
        ],
      },
    ),
  )!
}

it('groups decisions in author order and derives defaults without parsing the Markdown question', () => {
  const brief = projectStackBrief(decisionsBrief(), 'stack-1', [])
  const groups = groupDecisions(brief)
  expect(groups.map(({ id, defaults }) => [id, defaults.length > 0])).toEqual([
    ['opposed', false],
    ['disputed', false],
    ['openQuestion', false],
    ['crossLayer', false],
    ['reversal', true],
    ['predicted', true],
  ])
  const [opposed, disputed, open, structure, reversal, predicted] = groups.map(
    (group) => group.decisions[0]!,
  )
  expect(opposed?.options).toMatchObject([
    { id: '#201/first', recommended: false, change: { layer: 201, plan: 'Fix first.' } },
    {
      id: '#201/second',
      recommended: false,
      change: { layer: 202, plan: 'Fix second.', field: 'description' },
    },
    { id: 'neither', recommended: false },
  ])
  expect(disputed?.options.every((option) => !option.recommended)).toBe(true)
  expect(open?.options.map((option) => option.id)).toEqual(['keep'])
  expect(structure?.options[0]?.change).toMatchObject({
    layer: 203,
    structure: { action: 'fold', into: 202 },
  })
  expect(reversal?.options.map((option) => [option.id, option.recommended])).toEqual([
    ['change', false],
    ['keep', true],
  ])
  expect(reversal?.evidence[0]?.reverses?.request.plan).toBe('Use a map.')
  expect(predicted?.options[0]).toEqual({
    id: 'keep',
    label: 'Keep the code and reply',
    recommended: true,
    reply: 'The code shows it.',
  })
  expect(reviewLead(brief)).toBe('0 of 6 answered. 4 questions need you. 2 more have a default.')
})

it('groups only disputed resolutions under model disagreement', () => {
  const brief = stackBrief(
    finishedStackReview([
      stackEntry(201, 'edge', { kind: 'edgeCase', impact: 'data', disposition: 'ask' }),
      stackEntry(201, 'unverified', { resolution: 'unverified', disposition: 'ask' }),
      stackEntry(201, 'disputed', { resolution: 'disputed', disposition: 'ask' }),
    ]),
  )!

  expect(
    groupDecisions(brief).map(({ label, decisions }) => [label, decisions.map(({ id }) => id)]),
  ).toEqual([
    ['The two models disagree', ['#201/disputed']],
    ['Your call', ['#201/edge', '#201/unverified']],
  ])
})

it('gives contested ownership two target layers and contested chains a change-or-keep choice', () => {
  const session = finishedStackReview(
    [stackEntry(201, 'moved'), stackEntry(202, 'cause'), stackEntry(203, 'effect')],
    {
      ...emptyResult,
      ownership: [{ entry: '#201/moved', layer: 202, reason: 'The caller is here.' }],
      chains: [
        {
          cause: '#202/cause',
          unnecessary: ['#203/effect'],
          reason: 'It removes the only caller.',
        },
      ],
    },
  )
  session.pass!.contested = ['ownership #201/moved', 'chain #202/cause']
  const brief = stackBrief(session)!
  const [ownership, chain] = brief.decisions
  expect(ownership?.group).toBe('crossLayer')
  expect(ownership?.options.map((option) => [option.id, option.change?.layer])).toEqual([
    ['layer-201', 201],
    ['layer-202', 202],
    ['keep', undefined],
  ])
  expect(chain?.options.map((option) => [option.id, option.change?.layer])).toEqual([
    ['change', 203],
    ['keep', undefined],
  ])
  expect(briefOnLayer(brief, 202).decisions).toEqual([ownership])
  expect(brief.chains).toHaveLength(0)
})

it('counts visible work and unread entries, retaining a chain beside its cause on either layer', () => {
  const session = finishedStackReview(
    [
      stackEntry(201, 'cause', { impact: 'data', consequence: 'Stored jobs could disappear.' }),
      stackEntry(203, 'effect'),
      stackEntry(203, 'unread', { disposition: 'skip', title: 'Document the limit' }),
      stackEntry(202, 'question', { disposition: 'ask', question: 'Keep the old flag?' }),
    ],
    {
      ...emptyResult,
      chains: [
        {
          cause: '#201/cause',
          unnecessary: ['#203/effect'],
          reason: 'It removes the only caller.',
        },
      ],
    },
  )
  session.layers[1]!.baseSha = 'new-base'
  session.input!.left = ['#203/unread']
  session.input!.limitations = ['No grounding was available for one panel.']
  const brief = stackBrief(session)!
  expect(briefCounts(brief)).toMatchObject({
    serious: 1,
    needsAnswer: 1,
    fixes: 1,
    unread: 1,
    moved: 1,
  })
  expect(stripCounts(brief)).toBe(
    '1 serious consequence · 1 question needs you · 1 fix ready · 1 entry not read · 1 layer moved since its panel',
  )
  expect(coverageWarnings(brief)).toEqual([
    'The cross-layer pass did not read 1 entry.',
    'No grounding was available for one panel.',
    'Some findings may be stale. See Review notes for the revisions involved.',
  ])
  expect(briefOnLayer(brief, 203).unread).toEqual([
    { id: '#203/unread', layer: 203, title: 'Document the limit' },
  ])
  expect(briefOnLayer(brief, 203).chains[0]?.cause.id).toBe('#201/cause')
  expect(briefOnLayer(brief, 201).chains[0]?.unnecessary[0]?.id).toBe('#203/effect')
})

it('keeps same-action structure proposals separately addressable in the saved review', () => {
  const proposal = {
    action: 'split' as const,
    layer: 201,
    reason: 'Isolate storage.',
    cost: 'A rebase.',
  }
  const session = finishedStackReview([], {
    ...emptyResult,
    structure: [proposal, { ...proposal, reason: 'Isolate rendering.' }],
  })
  const ids = () => stackBrief(session)!.decisions.map(({ id }) => id)
  expect(new Set(ids()).size).toBe(2)
  expect(ids()).toEqual(ids())
})
