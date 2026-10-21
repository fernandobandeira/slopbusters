import { describe, expect, it } from 'vitest'
import {
  groundingProblems,
  groundingReplySchema,
  selectCandidates,
  type GroundedEntry,
  type GroundingCandidate,
  type GroundingState,
  type GroundingTurn,
} from '../shared/domain/grounding'
import { groundedAdvice, recordTurn, resolveEntries } from '../shared/domain/groundingResult'
import { fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { primary, companion } from './fixtures/panelJobs'

const findings = (seat: string, count: number) =>
  fixturePanelAdvice(
    Array.from({ length: count }, (_, index) =>
      fixturePanelFinding({ id: `finding-${String(index)}`, title: `${seat} ${String(index)}` }),
    ),
  )

function entry(sources: string[], changes: Partial<GroundedEntry> = {}): GroundedEntry {
  return {
    id: `g-${sources.join('-')}`,
    sources,
    verdict: 'legit',
    reason: 'The audit helper already does this.',
    evidence: ['src/audit.ts:4'],
    plan: 'Reuse the audit helper.',
    destination: { kind: 'code', pull: 12 },
    ...changes,
  }
}

function turn(entries: GroundedEntry[], changes: Partial<GroundingTurn> = {}): GroundingTurn {
  return { entries, approved: false, summary: 'Grounded.', objections: [], ...changes }
}

function scope(candidates: GroundingCandidate[]) {
  return { candidates, pulls: [12] }
}

describe('choosing what a round grounds', () => {
  it('takes each seat’s next ranked finding in roster order and defers the rest', () => {
    const candidates = selectCandidates(
      12,
      [
        { reviewer: 'unclebob', advice: findings('bob', 3) },
        { reviewer: 'teammate:avery', advice: findings('avery', 1) },
      ],
      3,
    )

    expect(
      candidates.map((candidate) => [candidate.key, candidate.finding.title, candidate.state]),
    ).toEqual([
      ['f1', 'bob 0', 'selected'],
      ['f2', 'avery 0', 'selected'],
      ['f3', 'bob 1', 'selected'],
      ['f4', 'bob 2', 'deferred'],
    ])
  })

  it('keeps two seats’ findings apart when their own ids collide', () => {
    const candidates = selectCandidates(
      12,
      [
        { reviewer: 'unclebob', advice: findings('bob', 1) },
        { reviewer: 'terminator', advice: findings('terminator', 1) },
      ],
      40,
    )

    expect(
      candidates.map((candidate) => [candidate.key, candidate.seat, candidate.finding.id]),
    ).toEqual([
      ['f1', 'unclebob', 'finding-0'],
      ['f2', 'terminator', 'finding-0'],
    ])
  })
})

describe('a grounded list', () => {
  const candidates = selectCandidates(
    12,
    [
      { reviewer: 'unclebob', advice: findings('bob', 2) },
      { reviewer: 'terminator', advice: findings('terminator', 1) },
    ],
    2,
  )

  it('passes when its entries partition the selected sources', () => {
    expect(groundingProblems(turn([entry(['f1', 'f2'])]), scope(candidates))).toEqual([])
  })

  it('fails on a missing, invented, deferred or repeated source', () => {
    const problems = groundingProblems(
      turn([entry(['f1', 'f9']), entry(['f1', 'f3'], { id: 'again' })]),
      scope(candidates),
    )

    expect(problems).toEqual(
      expect.arrayContaining([
        'g-f1-f9 cites f9, which is not a source.',
        'again cites f3, which is not a source.',
        'f1 appears in more than one entry.',
        'No entry accounts for f2.',
      ]),
    )
  })

  it('needs a plan, a question, evidence or what is missing for the verdict it gives', () => {
    const problems = groundingProblems(
      turn([
        entry(['f1'], { plan: undefined }),
        entry(['f2'], { verdict: 'notTrue', evidence: ['it looked fine'] }),
      ]),
      scope(candidates),
    )

    expect(problems).toEqual([
      'g-f1: a legit entry needs a plan.',
      'g-f2: evidence "it looked fine" is neither path:line nor a title: or description: quote.',
    ])
    expect(
      groundingProblems(
        turn([entry(['f1'], { verdict: undefined }), entry(['f2'], { verdict: 'authorsCall' })]),
        scope(candidates),
      ),
    ).toEqual([
      'g-f1: without a verdict, say in missing which evidence would settle it.',
      "g-f2: an author's call needs the question to ask.",
    ])
  })

  it('keeps a question for the author an author’s call unless code disproves it', () => {
    const questions = candidates.map((candidate) => ({
      ...candidate,
      finding: { ...candidate.finding, tag: 'decision' as const },
    }))

    expect(groundingProblems(turn([entry(['f1', 'f2'])]), scope(questions))).toEqual([
      "g-f1-f2: its sources are questions for the author; it stays an author's call unless code disproves it.",
    ])
  })
})

describe('a grounded reply', () => {
  const candidates = selectCandidates(
    12,
    [
      { reviewer: 'unclebob', advice: findings('bob', 2) },
      { reviewer: 'terminator', advice: findings('terminator', 1) },
    ],
    2,
  )

  it('is rejected by the reply schema, so the runner asks the model to correct it', () => {
    const parsed = groundingReplySchema(scope(candidates)).safeParse(turn([entry(['f1'])]))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      'No entry accounts for f2.',
    ])
  })

  it('fits forty entries at every field’s maximum length', () => {
    const many = selectCandidates(12, [{ reviewer: 'unclebob', advice: findings('bob', 40) }], 40)
    const longest = (length: number) => 'x'.repeat(length)
    const entries = many.map((candidate, index) =>
      entry([candidate.key], {
        id: `g${String(index)}-`.padEnd(40, 'x'),
        reason: longest(400),
        evidence: Array.from({ length: 4 }, () => `src/${longest(190)}.ts:12`),
        plan: longest(400),
        destination: { kind: 'code', pull: 12 },
      }),
    )
    const reply = turn(entries, {
      summary: longest(1500),
      objections: entries.map((item) => ({ entry: item.id, objection: longest(400) })),
    })

    expect(groundingReplySchema(scope(many)).safeParse(reply).error?.issues).toBeUndefined()
    expect(JSON.stringify(reply).length).toBeLessThan(100_000)
  })
})

function state(candidates: GroundingCandidate[]): GroundingState {
  return {
    budget: 40,
    candidates,
    roles: { primary, secondary: companion },
    turns: [],
    entries: [],
    positions: {},
  }
}

describe('a debate that runs out of turns', () => {
  const candidates = selectCandidates(
    12,
    [{ reviewer: 'unclebob', advice: findings('bob', 3) }],
    40,
  )
  const seat = () => 'unclebob'

  it('keeps accepted, conflicting and never-assessed entries apart', () => {
    const grounding = state(candidates)
    recordTurn(grounding, {
      role: 'primary',
      model: primary,
      reply: turn([entry(['f1']), entry(['f2'])]),
    })
    recordTurn(grounding, {
      role: 'secondary',
      model: companion,
      reply: turn([
        entry(['f1']),
        entry(['f2'], { verdict: 'tasteSkip', plan: undefined }),
        entry(['f3']),
      ]),
    })
    grounding.outcome = 'exhausted'

    const resolved = resolveEntries(grounding, seat)

    expect(resolved.map((item) => [item.id, item.resolution])).toEqual([
      ['g-f1', 'agreed'],
      ['g-f2', 'disputed'],
      ['g-f3', 'unverified'],
    ])
    expect(resolved[1]?.other?.entries[0]?.verdict).toBe('legit')
  })

  it('does not count a reason rewritten on the last turn as agreed', () => {
    const grounding = state(candidates.slice(0, 1))
    recordTurn(grounding, { role: 'primary', model: primary, reply: turn([entry(['f1'])]) })
    recordTurn(grounding, {
      role: 'secondary',
      model: companion,
      reply: turn([entry(['f1'], { reason: 'Reworded on the final turn.' })]),
    })
    grounding.outcome = 'exhausted'

    expect(resolveEntries(grounding, seat)[0]?.resolution).toBe('unverified')
  })

  it('keeps an entry without a verdict unverified even when both models agree on it', () => {
    const grounding = state(candidates.slice(0, 1))
    const open = entry(['f1'], { verdict: undefined, plan: undefined, missing: 'Production rows.' })
    recordTurn(grounding, { role: 'primary', model: primary, reply: turn([open]) })
    recordTurn(grounding, {
      role: 'secondary',
      model: companion,
      reply: turn([open], { approved: true }),
    })
    grounding.outcome = 'agreed'

    expect(resolveEntries(grounding, seat)[0]?.resolution).toBe('unverified')
  })
})

describe('a grounded round as a review', () => {
  it('never calls a PR clean while it has limits, and sets agreed rejections aside', () => {
    const candidates = selectCandidates(
      12,
      [{ reviewer: 'unclebob', advice: findings('bob', 1) }],
      40,
    )
    const grounding = state(candidates)
    const rejected = entry(['f1'], {
      verdict: 'notTrue',
      plan: undefined,
      reason: 'The helper is already used.',
    })
    recordTurn(grounding, { role: 'primary', model: primary, reply: turn([rejected]) })
    grounding.outcome = 'agreed'
    grounding.resolved = resolveEntries(grounding, () => 'unclebob')

    const advice = groundedAdvice(grounding, {
      summary: 'Nothing holds up.',
      limitations: ['Unclebob may have had more.'],
    })

    expect(advice.verdict).toBe('uncertain')
    expect(advice.summary).toBe('No further accepted fixes in this round. Nothing holds up.')
    expect(advice.findings).toEqual([])
    expect(advice.setAside[0]?.reason).toBe('Not true: The helper is already used.')
  })
})
