import { describe, expect, it } from 'vitest'
import {
  groundingProblems,
  groundingReplySchema,
  selectCandidates,
  type GroundedEntry,
} from '../../../shared/domain/grounding'
import { fixturePanelAdvice, fixturePanelFinding } from '../../fixtures/panel'

const candidates = selectCandidates(
  12,
  [
    {
      reviewer: 'unclebob',
      advice: fixturePanelAdvice([
        fixturePanelFinding({ id: 'finding-0', title: 'First' }),
        fixturePanelFinding({ id: 'finding-1', title: 'Second' }),
      ]),
    },
  ],
  2,
)

function entry(source: string, changes: Partial<GroundedEntry>): GroundedEntry {
  return {
    id: `g-${source}`,
    sources: [source],
    verdict: 'legit',
    reason: 'The code shows it.',
    evidence: ['src/audit.ts:4'],
    plan: 'Fix it.',
    origin: 'change',
    kind: 'defect',
    effort: 'small',
    destination: { kind: 'code', pull: 12 },
    ...changes,
  }
}

function problems(first: Partial<GroundedEntry>, second: Partial<GroundedEntry>) {
  return groundingProblems(
    {
      entries: [entry('f1', first), entry('f2', second)],
      approved: false,
      summary: 'Grounded.',
      objections: [],
    },
    { candidates, pulls: [12] },
  )
}

describe('what is at stake in a grounded entry', () => {
  it('is asked of every entry', () => {
    expect(problems({}, { impact: 'data', consequence: 'Rows double on retry.' })).toEqual([
      'g-f1: say in impact what is at stake if the finding holds.',
    ])
  })

  it('says how a serious consequence happens and who notices, unless the finding is rejected', () => {
    expect(
      problems(
        { impact: 'money' },
        { impact: 'money', verdict: 'notTrue', plan: undefined, evidence: ['src/a.ts:1'] },
      ),
    ).toEqual([
      'g-f1: a money impact needs consequence: what triggers it, what goes wrong and who notices.',
    ])
  })
})

describe('a grounded reply with what is at stake', () => {
  it('fits forty entries at every field’s maximum length', () => {
    const many = selectCandidates(
      12,
      [
        {
          reviewer: 'unclebob',
          advice: fixturePanelAdvice(
            Array.from({ length: 40 }, (_, index) =>
              fixturePanelFinding({
                id: `finding-${String(index)}`,
                title: `bob ${String(index)}`,
              }),
            ),
          ),
        },
      ],
      40,
    )
    const longest = (length: number) => 'x'.repeat(length)
    const entries = many.map((candidate, index) =>
      entry(candidate.key, {
        id: `g${String(index)}-`.padEnd(40, 'x'),
        reason: longest(400),
        evidence: Array.from({ length: 4 }, () => `src/${longest(190)}.ts:12`),
        plan: longest(400),
        impact: 'money',
        consequence: longest(300),
      }),
    )
    const reply = {
      entries,
      approved: false,
      summary: longest(1500),
      objections: entries.map((item) => ({ entry: item.id, objection: longest(400) })),
    }

    expect(
      groundingReplySchema({ candidates: many, pulls: [12] }).safeParse(reply).error?.issues,
    ).toBeUndefined()
    // A provider's structured reply has to hold this; real replies are a fraction of it.
    expect(JSON.stringify(reply).length).toBeLessThan(110_000)
  })
})
