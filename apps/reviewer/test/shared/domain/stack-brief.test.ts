import { describe, expect, it } from 'vitest'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import type { CrossLayerResult, StackEntry } from '../../../shared/domain/stackReview'
import {
  emptyResult,
  finishedStackReview,
  passLayer,
  stackEntry,
  stackRepository,
} from '../../fixtures/stackReview'

describe('the stack brief across layers', () => {
  it('collapses duplicates into the entry that owns the change, which names the others', () => {
    const session = finishedStackReview(
      [stackEntry(201, 'g1'), stackEntry(202, 'g3'), stackEntry(203, 'g1')],
      {
        ...emptyResult,
        duplicates: [
          {
            entries: ['#201/g1', '#202/g3', '#203/g1'],
            owner: '#201/g1',
            reason: 'All three ask for the same guard.',
          },
        ],
      },
    )

    const brief = stackBrief(session)

    expect(
      brief?.fixes.map(({ layer, items }) => [layer.number, items.map((item) => item.id)]),
    ).toEqual([[201, ['#201/g1']]])
    expect(brief?.fixes[0]?.items[0]?.alsoRaised).toEqual(['#202/g3', '#203/g1'])
  })

  it('keeps a question in the decision queue even when a chain would make it unnecessary', () => {
    const question = { disposition: 'ask' as const, question: 'Keep the retry?' }
    const session = finishedStackReview(
      [stackEntry(201, 'g1', question), stackEntry(203, 'g4', question)],
      {
        ...emptyResult,
        chains: [{ cause: '#203/g4', unnecessary: ['#201/g1'], reason: 'The job goes.' }],
      },
    )

    expect(stackBrief(session)?.decisions.map((item) => item.id)).toEqual(['#201/g1', '#203/g4'])
  })

  it('lists entries a chain makes unnecessary under the chain, not as fixes', () => {
    const session = finishedStackReview(
      [
        stackEntry(201, 'g1'),
        stackEntry(201, 'g2'),
        stackEntry(203, 'g4', { kind: 'simplification' }),
      ],
      {
        ...emptyResult,
        chains: [
          {
            cause: '#203/g4',
            unnecessary: ['#201/g1', '#201/g2'],
            reason: 'Once the job is gone, nothing reads the state the bottom layer adds.',
          },
        ],
      },
    )

    const brief = stackBrief(session)

    expect(brief?.fixes.flatMap(({ items }) => items.map((item) => item.id))).toEqual(['#203/g4'])
    expect(brief?.chains).toEqual([
      {
        cause: { id: '#203/g4', title: 'Finding g4 on #203' },
        reason: 'Once the job is gone, nothing reads the state the bottom layer adds.',
        unnecessary: [
          { id: '#201/g1', title: 'Finding g1 on #201' },
          { id: '#201/g2', title: 'Finding g2 on #201' },
        ],
      },
    ])
  })
})

describe('the stack brief decision queue', () => {
  it('queues every question for the author across the stack with the proposals to reshape it', () => {
    const question = {
      verdict: 'authorsCall' as const,
      disposition: 'ask' as const,
      question: 'Should the export keep the old column?',
      plan: 'Keep it for one release.',
      effort: 'medium' as const,
      triage: 'The recommendation goes against the ticket.',
    }
    const session = finishedStackReview(
      [stackEntry(201, 'g1'), stackEntry(203, 'g2', question), stackEntry(202, 'g5', question)],
      {
        ...emptyResult,
        duplicates: [
          { entries: ['#202/g5', '#203/g2'], owner: '#202/g5', reason: 'Same question.' },
        ],
        structure: [
          {
            action: 'fold',
            layer: 202,
            into: 201,
            reason: 'It only renames.',
            cost: 'One rebase.',
          },
        ],
      },
    )

    const brief = stackBrief(session)

    expect(brief?.decisions).toEqual([
      {
        id: '#202/g5',
        layer: 202,
        title: 'Finding g5 on #202',
        question: 'Should the export keep the old column?',
        recommendation: 'Keep it for one release.',
        cost: 'medium',
        why: 'The recommendation goes against the ticket.',
        contested: false,
      },
      {
        id: '#202',
        layer: 202,
        title: 'Fold PR #202 into PR #201',
        question: 'Fold PR #202 into PR #201?',
        recommendation: 'It only renames.',
        cost: 'One rebase.',
        why: 'Only the whole stack shows this.',
        contested: false,
      },
    ])
  })
})

describe('the stack brief fixes', () => {
  it('places fixes on the layer that owns the code, in triage order, with derived findings', () => {
    const session = finishedStackReview(
      [
        stackEntry(201, 'g1', { kind: 'test', rank: 4 }),
        stackEntry(203, 'g2', { destination: { pull: 203 } }),
      ],
      {
        ...emptyResult,
        ownership: [
          { entry: '#203/g2', layer: 201, reason: 'The helper lives in the bottom layer.' },
        ],
        derived: [
          {
            id: 'd1',
            title: 'Remove the unused state',
            plan: 'Delete the field and its writer.',
            kind: 'simplification',
            effort: 'small',
            impact: 'behavior',
            layer: 201,
            from: ['#203/g2'],
          },
        ],
      },
    )

    const items = stackBrief(session)?.fixes[0]?.items ?? []

    expect(items.map((item) => item.id)).toEqual(['d1', '#203/g2', '#201/g1'])
    expect(items[0]?.derivedFrom).toEqual(['#203/g2'])
    expect(items[1]?.movedFrom).toEqual({
      layer: 203,
      reason: 'The helper lives in the bottom layer.',
    })
  })

  it('folds pre-existing problems and edge cases into follow-ups', () => {
    const session = finishedStackReview([
      stackEntry(201, 'g1', {
        disposition: 'skip',
        origin: 'preexisting',
        triage: 'Already there.',
        followUp: true,
      }),
      stackEntry(202, 'g2', {
        disposition: 'skip',
        kind: 'edgeCase',
        triage: 'Needs two failures.',
        followUp: true,
      }),
      stackEntry(202, 'g3', { disposition: 'skip', verdict: 'notTrue', origin: 'preexisting' }),
      stackEntry(203, 'g4', { disposition: 'skip', verdict: 'tasteSkip', origin: 'preexisting' }),
    ])

    const brief = stackBrief(session)

    expect(brief?.followUps.map((item) => item.id)).toEqual(['#201/g1', '#202/g2'])
    expect(brief?.fixes).toEqual([])
  })
})

describe('the stack brief caveats and Markdown', () => {
  it('marks layers that moved since their panel and entries settled by a moved layer', () => {
    const session = finishedStackReview([
      stackEntry(201, 'g1', { settledBy: 202, verdict: 'handledUpstack', disposition: 'skip' }),
      stackEntry(202, 'g1'),
    ])
    if (!session.input) throw new Error('Missing input.')
    session.input.layers[0] = passLayer(201, { read: [{ pull: 202, headSha: '202bbbbbbbb' }] })
    session.layers[2] = { ...session.layers[2]!, headSha: '203cccccccc' }

    const brief = stackBrief(session)

    expect(brief?.layers.map((layer) => layer.current)).toEqual([true, true, false])
    expect(brief?.stale).toEqual([
      {
        layer: 203,
        entries: [],
        reason: 'PR #203 moved since its panel reviewed `203aaaa`; it is at `203cccc` now.',
      },
      {
        layer: 202,
        entries: ['#201/g1'],
        reason: 'Settled by PR #202 at `202bbbb`, which is at `202aaaa` now.',
      },
    ])
  })

  it('marks a layer whose base moved even when its head did not', () => {
    const session = finishedStackReview([stackEntry(202, 'g1')])
    session.layers[1] = { ...session.layers[1]!, baseSha: 'base-new' }

    const brief = stackBrief(session)

    expect(brief?.layers.map((layer) => layer.current)).toEqual([true, false, true])
    expect(brief?.stale).toEqual([
      {
        layer: 202,
        entries: ['#202/g1'],
        reason:
          "PR #202's base moved since its panel reviewed it on `base-20`; it is on `base-ne` now, so its diff may differ.",
      },
    ])
  })

  it('writes Markdown an agent can work from, decisions first and layers bottom to top', () => {
    const session = finishedStackReview(
      [
        stackEntry(203, 'g1'),
        stackEntry(201, 'g2'),
        stackEntry(202, 'g4', { disposition: 'ask', question: 'Keep the flag?' }),
      ],
      emptyResult,
      { pass: { ...finishedStackReview([]).pass!, outcome: 'exhausted', contested: [] } },
    )

    const markdown = stackBriefMarkdown(stackBrief(session)!, stackRepository)

    expect(markdown).toContain('# Stack review of review-room/example, PR #201 to PR #203')
    expect(markdown).toContain(
      '1. PR #201 "Layer 201" (https://github.com/review-room/example/pull/201): reviewed at `201aaaa`, still current',
    )
    expect(markdown.indexOf('## Needs your decision')).toBeLessThan(markdown.indexOf('## Fixes'))
    expect(markdown.indexOf('### PR #201')).toBeLessThan(markdown.indexOf('### PR #203'))
    expect(markdown).toContain('  Question: Keep the flag?')
    expect(markdown).toContain('   Plan: Fix g2.')
    expect(markdown).toContain(
      'The two models did not agree on the cross-layer pass within 1 turns.',
    )
  })
})

const contestedReview = (entries: StackEntry[], result: CrossLayerResult, contested: string[]) =>
  finishedStackReview(entries, result, {
    pass: { ...finishedStackReview([]).pass!, result, outcome: 'exhausted', contested },
  })
const fixIds = (brief: ReturnType<typeof stackBrief>) =>
  brief?.fixes.flatMap(({ items }) => items.map((item) => item.id))

describe('cross-layer conclusions the second model did not approve', () => {
  it('asks which layer a contested move belongs on, and fixes it on neither', () => {
    const session = contestedReview(
      [stackEntry(203, 'g2')],
      {
        ...emptyResult,
        ownership: [{ entry: '#203/g2', layer: 201, reason: 'The helper lives at the bottom.' }],
      },
      ['ownership #203/g2'],
    )

    const brief = stackBrief(session)

    expect(fixIds(brief)).toEqual([])
    expect(brief?.decisions).toMatchObject([
      {
        id: '#203/g2',
        question:
          'Which layer does this change belong on: PR #203, where its panel put it, or PR #201, where the cross-layer pass moved it? The helper lives at the bottom. The second model did not approve that.',
        recommendation: 'Fix g2.',
        contested: true,
      },
    ])
  })

  it('retires nothing through a contested chain, and asks about each change it would retire', () => {
    const session = contestedReview(
      [
        stackEntry(201, 'g1'),
        stackEntry(201, 'g2', { disposition: 'skip', triage: 'A preference.' }),
        stackEntry(203, 'g4', { title: 'Remove the job' }),
      ],
      {
        ...emptyResult,
        chains: [
          { cause: '#203/g4', unnecessary: ['#201/g1', '#201/g2'], reason: 'Nothing reads it.' },
        ],
      },
      ['chain #203/g4'],
    )

    const brief = stackBrief(session)

    expect(brief?.chains).toEqual([])
    expect(fixIds(brief)).toEqual(['#203/g4'])
    expect(brief?.decisions.map((item) => [item.id, item.question])).toEqual([
      [
        '#201/g1',
        '#203/g4 (Remove the job) may make this unnecessary: Nothing reads it. The second model did not approve that. Still make this change?',
      ],
    ])
  })
})

describe('contested duplicates and derived findings', () => {
  it('keeps a contested duplicate group apart, asking whether each member repeats its owner', () => {
    const session = contestedReview(
      [stackEntry(201, 'g1', { title: 'Guard the input' }), stackEntry(202, 'g3')],
      {
        ...emptyResult,
        duplicates: [{ entries: ['#201/g1', '#202/g3'], owner: '#201/g1', reason: 'One guard.' }],
      },
      ['duplicate #201/g1'],
    )

    const brief = stackBrief(session)

    expect(fixIds(brief)).toEqual(['#201/g1'])
    expect(brief?.fixes[0]?.items[0]?.alsoRaised).toEqual([])
    expect(brief?.decisions.map((item) => [item.id, item.question])).toEqual([
      [
        '#202/g3',
        'This may repeat #201/g1 (Guard the input): One guard. The second model did not approve that. Make it separately?',
      ],
    ])
  })

  it('makes a contested derived finding a decision', () => {
    const session = contestedReview(
      [stackEntry(203, 'g2')],
      {
        ...emptyResult,
        derived: [
          {
            id: 'd1',
            title: 'Remove the unused state',
            plan: 'Delete the field.',
            kind: 'simplification',
            effort: 'small',
            impact: 'behavior',
            layer: 201,
            from: ['#203/g2'],
          },
        ],
      },
      ['derived d1'],
    )

    const brief = stackBrief(session)
    const markdown = stackBriefMarkdown(brief!, stackRepository)

    expect(fixIds(brief)).toEqual(['#203/g2'])
    expect(brief?.decisions).toMatchObject([
      {
        id: 'd1',
        layer: 201,
        question:
          'Only the whole stack shows this, derived from #203/g2. The second model did not approve it. Make this change?',
        recommendation: 'Delete the field.',
      },
    ])
    expect(markdown).not.toMatch(/^\d+\. .*did not approve/m)
  })
})
