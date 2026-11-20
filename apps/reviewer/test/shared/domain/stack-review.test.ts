import { describe, expect, it } from 'vitest'
import type { ResolvedEntry } from '../../../shared/domain/grounding'
import type { PanelResult } from '../../../shared/domain/panelSession'
import { passView, stackPassInput } from '../../../shared/domain/stackPassInput'
import {
  crossLayerProblems,
  type CrossLayerResult,
  type CrossLayerScope,
} from '../../../shared/domain/stackReview'
import { Provider } from '../../../shared/domain/types'
import { fixturePanelFinding } from '../../fixtures/panel'
import { fixturePull } from '../../fixtures/pull'
import { emptyResult } from '../../fixtures/stackReview'

const scope: CrossLayerScope = {
  entries: [{ id: '#201/g1' }, { id: '#202/g1' }, { id: '#203/g2' }],
  layers: [201, 202, 203],
}
const problems = (changes: Partial<CrossLayerResult>) =>
  crossLayerProblems({ ...emptyResult, ...changes }, scope)

describe('cross-layer output validation', () => {
  it('accepts a result that only uses the ids and layers it was given', () => {
    expect(
      problems({
        duplicates: [{ entries: ['#201/g1', '#202/g1'], owner: '#201/g1', reason: 'Same.' }],
        chains: [{ cause: '#203/g2', unnecessary: ['#201/g1'], reason: 'The job goes.' }],
        ownership: [{ entry: '#203/g2', layer: 201, reason: 'The code is on the bottom.' }],
        derived: [
          {
            id: 'd1',
            title: 'Drop the unused state',
            plan: 'Remove it.',
            kind: 'simplification',
            effort: 'small',
            layer: 201,
            from: ['#203/g2'],
          },
        ],
        structure: [{ action: 'fold', layer: 202, into: 201, reason: 'Tiny.', cost: 'A rebase.' }],
      }),
    ).toEqual([])
  })

  it('names ids it was not given and layers outside the stack', () => {
    expect(
      problems({
        chains: [{ cause: '#209/g1', unnecessary: ['#201/g1'], reason: 'Gone.' }],
        ownership: [{ entry: '#201/g1', layer: 999, reason: 'Elsewhere.' }],
      }),
    ).toEqual([
      'chains: #209/g1 is not an entry you were given.',
      'ownership: PR #999 is not a layer of this stack.',
    ])
  })

  it('refuses an id used twice in one relation, and an owner outside its group', () => {
    expect(
      problems({
        duplicates: [
          { entries: ['#201/g1', '#202/g1'], owner: '#201/g1', reason: 'Same.' },
          { entries: ['#202/g1', '#203/g2'], owner: '#201/g1', reason: 'Same.' },
        ],
      }),
    ).toEqual([
      'duplicates: #202/g1 is used more than once.',
      "duplicates: the owner #201/g1 must be one of its group's entries.",
    ])
  })
})

describe('cross-layer relations that contradict each other', () => {
  it('makes chains and moves name a duplicate group by its owner', () => {
    const duplicates = [{ entries: ['#201/g1', '#202/g1'], owner: '#201/g1', reason: 'Same.' }]

    expect(
      problems({
        duplicates,
        chains: [{ cause: '#203/g2', unnecessary: ['#202/g1'], reason: 'The job goes.' }],
        ownership: [{ entry: '#202/g1', layer: 203, reason: 'Elsewhere.' }],
      }),
    ).toEqual([
      'chains: #202/g1 is merged into a duplicate group; name its owner instead.',
      'ownership: #202/g1 is merged into a duplicate group; name its owner instead.',
    ])
  })

  it('takes one proposal per layer, and never a fold into the same layer', () => {
    expect(
      problems({
        structure: [
          { layer: 202, action: 'drop', reason: 'Nothing uses it.', cost: 'small' },
          { layer: 202, action: 'fold', into: 202, reason: 'Thin.', cost: 'small' },
        ],
      }),
    ).toEqual([
      'structure: PR #202 has more than one proposal; keep one.',
      'structure: PR #202 cannot fold into itself.',
    ])
  })
})

describe('cross-layer duplicates holding a marked entry', () => {
  const marked: CrossLayerScope = {
    entries: [
      { id: '#201/g1' },
      {
        id: '#202/g1',
        reverses: {
          request: {
            round: '2026-11-18',
            entry: '#202/g4',
            title: 'Embed the read',
            plan: 'Read it in the query.',
            reason: 'The lookup races.',
            asked: 'fix',
          },
          reason: 'It moves the read back out.',
        },
      },
      { id: '#203/g2', opposes: { entries: ['#203/g3'], reason: 'Opposite flags.' } },
    ],
    layers: [201, 202, 203],
  }
  const check = (owner: string, entries: string[]) =>
    crossLayerProblems(
      { ...emptyResult, duplicates: [{ entries, owner, reason: 'Same.' }] },
      marked,
    )

  it('refuses an unmarked owner, so the mark is never merged away', () => {
    expect(check('#201/g1', ['#201/g1', '#202/g1'])).toEqual([
      'duplicates: the group of #201/g1 holds a marked entry, so a marked entry must own it.',
    ])
  })

  it('accepts a marked owner', () => {
    expect(check('#202/g1', ['#201/g1', '#202/g1'])).toEqual([])
    expect(check('#203/g2', ['#202/g1', '#203/g2'])).toEqual([])
  })
})

describe('cross-layer derived findings', () => {
  it('refuses a derived finding without the entries it came from', () => {
    expect(
      problems({
        derived: [
          {
            id: 'd1',
            title: 'Something only the stack shows',
            plan: 'Remove it.',
            kind: 'simplification',
            effort: 'small',
            layer: 202,
            from: [],
          },
        ],
      }),
    ).toEqual(['derived: d1 needs the entries it was derived from in from.'])
  })
})

describe('the cross-layer pass input', () => {
  const rounds = [201, 202].map((number) => ({
    layer: {
      number,
      title: `Layer ${String(number)}`,
      url: `https://example.test/${String(number)}`,
    },
    current: panelResult(number, [entry('g1'), entry('g2', { origin: 'preexisting' })]),
  }))

  it('reads every entry when they fit', () => {
    const input = stackPassInput(rounds, 1_000_000)

    expect(input.left).toEqual([])
    expect(input.limitations).toEqual([])
    expect(input.entries.map((item) => item.id)).toEqual([
      '#201/g1',
      '#201/g2',
      '#202/g1',
      '#202/g2',
    ])
  })

  it('leaves out skipped entries past the budget, and says when even that is not enough', () => {
    const fitted = stackPassInput(rounds, 1)

    expect(fitted.left).toEqual(['#202/g2', '#201/g2'])
    expect(fitted.limitations).toEqual([
      "To fit the cross-layer pass's budget, 2 skipped entries were left out of it: #202/g2, #201/g2.",
      "Even without them, the cross-layer pass's input is over its budget; it read every remaining entry.",
    ])
    expect(passView(fitted).entries.map((entry) => entry.id)).toEqual(['#201/g1', '#202/g1'])
  })

  it('reads each entry with its triage, its layer and the lead finding title', () => {
    const input = stackPassInput(
      [
        {
          layer: { number: 201, title: 'Layer', url: 'https://example.test/201' },
          current: panelResult(201, [entry('g1', { settledBy: { pull: 202 } })]),
        },
      ],
      1_000_000,
    )

    expect(input.entries[0]).toMatchObject({
      id: '#201/g1',
      layer: 201,
      title: fixturePanelFinding().title,
      disposition: 'fix',
      triage: 'Corrects a confirmed defect.',
      settledBy: 202,
      destination: { pull: 201 },
    })
    expect(input.layers[0]).toMatchObject({ number: 201, reviewedHead: fixturePull().headSha })
  })
})

function entry(id: string, changes: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    id,
    sources: ['f1'],
    verdict: 'legit',
    reason: 'The code shows it.',
    evidence: ['src/job.ts:4'],
    plan: 'Fix it.',
    origin: 'change',
    kind: 'defect',
    effort: 'medium',
    impact: 'behavior',
    destination: { kind: 'code', pull: 201 },
    resolution: 'agreed',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

function panelResult(number: number, resolved: ResolvedEntry[]): PanelResult {
  const judge = { provider: Provider.claude, model: 'claude-fable-5-2' }
  return {
    pull: { ...fixturePull(), number },
    fingerprint: 'fingerprint',
    advice: {
      verdict: 'changes',
      summary: 'Fix it.',
      findings: [],
      setAside: [],
      good: [],
      limitations: [],
      disagreements: [],
    },
    reviews: [],
    grounding: {
      budget: 40,
      candidates: [
        {
          key: 'f1',
          pull: number,
          seat: 'unclebob',
          rank: 0,
          finding: fixturePanelFinding(),
          state: 'selected',
        },
      ],
      roles: { primary: judge },
      turns: [],
      entries: resolved,
      positions: {},
      outcome: 'agreed',
      resolved,
    },
  }
}
