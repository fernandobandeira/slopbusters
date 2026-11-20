import { describe, expect, it } from 'vitest'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import {
  emptyResult,
  finishedStackReview,
  stackEntry,
  stackRepository,
} from '../../fixtures/stackReview'

describe('predicted reviewer comments in the stack brief', () => {
  it('lists predicted comments with their replies, apart from fixes and decisions', () => {
    const prepared = {
      disposition: 'prepare' as const,
      verdict: 'predicted' as const,
      reason: 'The name matches the column.',
      effort: 'small' as const,
    }
    const session = finishedStackReview(
      [stackEntry(201, 'g1'), stackEntry(202, 'g2', prepared)],
      emptyResult,
    )

    const brief = stackBrief(session)

    expect(brief?.fixes.flatMap(({ items }) => items.map((item) => item.id))).toEqual(['#201/g1'])
    expect(brief?.decisions).toEqual([])
    expect(brief?.predictions).toMatchObject([
      { id: '#202/g2', layer: 202, reply: 'The name matches the column.', effort: 'small' },
    ])
    expect(stackBriefMarkdown(brief!, stackRepository)).toContain(
      'Reply if the code stays: The name matches the column.',
    )
  })
})

describe('serious consequences in the stack brief', () => {
  it('lists each serious entry with where the brief puts it', () => {
    const money = { impact: 'money' as const, consequence: 'A hold survives closure.' }
    const session = finishedStackReview(
      [
        stackEntry(201, 'g1', money),
        stackEntry(202, 'g2', { ...money, disposition: 'ask', triage: 'Needs the author.' }),
        stackEntry(203, 'g3', { impact: 'behavior' }),
        stackEntry(203, 'g4', { ...money, verdict: 'notTrue' }),
      ],
      emptyResult,
    )

    const brief = stackBrief(session)

    expect(brief?.serious.map((item) => [item.id, item.standing])).toEqual([
      ['#201/g1', 'a fix on PR #201.'],
      ['#202/g2', 'needs your decision. Needs the author.'],
    ])
    expect(stackBriefMarkdown(brief!, stackRepository)).toContain(
      'Consequence: A hold survives closure.',
    )
  })

  it('keeps a serious entry merged into a duplicate, pointing at the entry that carries it', () => {
    const session = finishedStackReview(
      [
        stackEntry(201, 'g1', { impact: 'behavior' }),
        stackEntry(205, 'g2', { impact: 'money', consequence: 'Funds reserve twice.' }),
      ],
      {
        ...emptyResult,
        duplicates: [
          { entries: ['#201/g1', '#205/g2'], owner: '#201/g1', reason: 'The same race.' },
        ],
      },
    )

    const serious = stackBrief(session)?.serious ?? []
    expect(serious.map((item) => [item.id, item.consequence])).toEqual([
      ['#205/g2', 'Funds reserve twice.'],
    ])
    expect(serious[0]?.standing).toContain('merged into #201/g1')
  })
})
