import { describe, expect, it } from 'vitest'
import type { ResolvedEntry } from '../../../shared/domain/grounding'
import { triage } from '../../../shared/domain/triage'
import { gateItems, initialGate } from '../../../shared/domain/panelGate'

const base: ResolvedEntry = {
  id: 'entry',
  sources: ['f1'],
  verdict: 'legit',
  reason: 'Confirmed.',
  evidence: [],
  plan: 'Remove the duplicate.',
  resolution: 'agreed',
  raisedBy: ['seat-a'],
  destination: { kind: 'code', pull: 1 },
}
const repeated: Partial<ResolvedEntry> = { effort: 'small', raisedBy: ['seat-a', 'seat-b'] }

describe('fixed triage policy', () => {
  it.each([
    [
      'missing evidence precedes disagreement',
      { verdict: undefined, resolution: 'disputed' },
      'skip',
    ],
    ['disagreement precedes rejection', { verdict: 'notTrue', resolution: 'disputed' }, 'ask'],
    ['single check precedes repetition', { ...repeated, resolution: 'unverified' }, 'ask'],
    ['disproof precedes repetition', { ...repeated, verdict: 'notTrue' }, 'skip'],
    ['over-engineering precedes repetition', { ...repeated, verdict: 'overEngineering' }, 'skip'],
    ['another layer precedes repetition', { ...repeated, verdict: 'handledUpstack' }, 'skip'],
    [
      'author decision precedes follow-up',
      { verdict: 'authorsCall', origin: 'preexisting' },
      'ask',
    ],
    ['follow-up precedes repetition', { ...repeated, origin: 'preexisting' }, 'skip'],
    ['cheap repetition precedes taste', { ...repeated, verdict: 'tasteSkip' }, 'fix'],
    ['cheap repetition precedes edge case', { ...repeated, kind: 'edgeCase' }, 'fix'],
    ['taste alone is skipped', { verdict: 'tasteSkip' }, 'skip'],
    [
      'a plan is required for repetition',
      { ...repeated, verdict: 'tasteSkip', plan: undefined },
      'skip',
    ],
    ['repetition must be cheap', { ...repeated, verdict: 'tasteSkip', effort: 'medium' }, 'skip'],
    [
      'distinct seats are required',
      { ...repeated, verdict: 'tasteSkip', raisedBy: ['seat-a', 'seat-a'] },
      'skip',
    ],
    ['combined edge cases are skipped', { kind: 'edgeCase' }, 'skip'],
  ] as const)('%s', (_name, changes, disposition) => {
    expect(
      triage({
        ...base,
        ...changes,
        raisedBy: [...(('raisedBy' in changes ? changes.raisedBy : undefined) ?? base.raisedBy)],
      }).disposition,
    ).toBe(disposition)
  })

  it.each([
    ['simplification', 0],
    ['defect', 1],
    ['rule', 1],
    ['wording', 2],
    ['product', 2],
    ['test', 3],
    [undefined, 1],
  ] as const)('fixes %s at rank %s, including legacy entries', (kind, rank) => {
    expect(triage({ ...base, kind })).toMatchObject({ disposition: 'fix', rank })
  })

  it('puts simplification decisions first', () => {
    expect(triage({ ...base, verdict: 'authorsCall', kind: 'simplification' }).rank).toBeLessThan(
      triage({ ...base, resolution: 'disputed' }).rank,
    )
  })

  it('selects policy fixes and carries the promoted taste plan without allowing rejected plans', () => {
    const entries = [
      { ...base, ...repeated, verdict: 'tasteSkip' as const },
      { ...base, id: 'edge', kind: 'edgeCase' as const },
      { ...base, id: 'rejected', ...repeated, verdict: 'notTrue' as const },
    ]
    expect(initialGate(entries).actions.map((a) => a.selected)).toEqual([true, false, false])
    const items = gateItems(entries, undefined, 1)
    expect(items[0]?.plan).toBe(base.plan)
    expect(items[0]?.problem).toBeUndefined()
    expect(items[2]?.plan).toBeUndefined()
  })
})
