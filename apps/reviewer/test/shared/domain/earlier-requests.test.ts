import { describe, expect, it } from 'vitest'
import { earlierRequests } from '../../../shared/domain/earlierRequests'
import { groundedEntry, groundedResult, groundedSource } from '../../fixtures/grounding'
import { emptyResult, finishedStackReview, stackEntry } from '../../fixtures/stackReview'

const createdAt = '2026-11-18T09:30:00.000Z'
const previous = groundedResult(
  [
    groundedEntry('g1', 'f1', { effort: 'small' }),
    groundedEntry('g2', 'f2', {
      verdict: 'authorsCall',
      question: 'Keep the export column?',
      ticketConflict: 'The ticket drops it.',
    }),
    groundedEntry('g3', 'f3', { verdict: 'notTrue', plan: undefined }),
  ],
  {
    candidates: [
      groundedSource('f1', 'Read the card with the payment'),
      groundedSource('f2', 'Keep the export column'),
      groundedSource('f3', 'Unused helper'),
    ],
  },
)

describe('what earlier rounds asked for, from the previous panel round', () => {
  it('takes its fixes and what it put to the author, keyed newest first', () => {
    expect(earlierRequests(128, { result: previous, createdAt }, 40_000)).toEqual({
      requests: [
        {
          key: 'e1',
          round: '2026-11-18',
          entry: 'g1',
          title: 'Read the card with the payment',
          plan: 'Plan for g1.',
          reason: 'Reason for g1.',
          asked: 'fix',
        },
        {
          key: 'e2',
          round: '2026-11-18',
          entry: 'g2',
          title: 'Keep the export column',
          plan: 'Plan for g2.',
          reason: 'Reason for g2.',
          asked: 'decision',
        },
      ],
      left: 0,
    })
  })

  it('carries forward what that round was given, re-keyed after its own', () => {
    const older = {
      key: 'e1',
      round: '2026-11-17',
      entry: 'g9',
      title: 'Express the capability in one field',
      plan: 'One field per method.',
      reason: 'Two booleans allow a contradiction.',
      asked: 'fix' as const,
    }
    const result = {
      ...previous,
      grounding: { ...previous.grounding!, earlier: { requests: [older], left: 2 } },
    }

    const earlier = earlierRequests(128, { result, createdAt }, 40_000)

    expect(earlier?.requests.map((item) => [item.key, item.entry, item.round])).toEqual([
      ['e1', 'g1', '2026-11-18'],
      ['e2', 'g2', '2026-11-18'],
      ['e3', 'g9', '2026-11-17'],
    ])
    expect(earlier?.left).toBe(2)
  })

  it('leaves out the oldest past its budget and counts them', () => {
    const one = JSON.stringify(
      earlierRequests(128, { result: previous, createdAt }, 40_000)?.requests[0],
    ).length

    const earlier = earlierRequests(128, { result: previous, createdAt }, one)

    expect(earlier?.requests.map((item) => item.entry)).toEqual(['g1'])
    expect(earlier?.left).toBe(1)
  })

  it('has nothing to give without a previous round', () => {
    expect(earlierRequests(128, undefined, 40_000)).toBeUndefined()
  })
})

describe('what earlier rounds asked for, from a stack review built on that round', () => {
  const stack = finishedStackReview(
    [
      stackEntry(202, 'g1', { title: 'Move the guard down' }),
      stackEntry(201, 'g2', { reason: 'The bottom layer owns it.' }),
      stackEntry(201, 'g4', { disposition: 'ask', question: 'Keep the flag?' }),
      stackEntry(203, 'g5'),
      stackEntry(201, 'prediction', { disposition: 'prepare', verdict: 'predicted' }),
    ],
    {
      ...emptyResult,
      ownership: [{ entry: '#202/g1', layer: 201, reason: 'The guard lives at the bottom.' }],
      derived: [
        {
          id: 'd1',
          title: 'Remove the unused state',
          plan: 'Delete the field.',
          kind: 'simplification',
          effort: 'small',
          impact: 'behavior',
          layer: 201,
          from: ['#203/g5'],
        },
      ],
      structure: [{ action: 'drop', layer: 201, reason: 'Thin.', cost: 'A rebase.' }],
    },
  )
  const asked = (pull: number) =>
    earlierRequests(pull, { result: previous, createdAt, stack }, 40_000)?.requests.map((item) => [
      item.entry,
      item.asked,
      item.round,
    ])

  it('takes every fix placed on the layer, moved in or derived, and its decisions', () => {
    expect(asked(201)).toEqual([
      ['d1', 'fix', '2026-11-13'],
      ['#202/g1', 'fix', '2026-11-13'],
      ['#201/g2', 'fix', '2026-11-13'],
      ['#201/g4', 'decision', '2026-11-13'],
    ])
  })

  it('takes a fix raised on the layer and moved away from it', () => {
    expect(asked(202)).toEqual([['#202/g1', 'fix', '2026-11-13']])
  })

  it('keeps the reason grounding wrote and the question put to the author', () => {
    const requests = earlierRequests(201, { result: previous, createdAt, stack }, 40_000)?.requests

    expect(requests?.find((item) => item.entry === '#201/g2')?.reason).toBe(
      'The bottom layer owns it.',
    )
    expect(requests?.find((item) => item.entry === '#201/g4')).toMatchObject({
      plan: 'Fix g4.',
      reason: 'Keep the flag?',
    })
  })
})
