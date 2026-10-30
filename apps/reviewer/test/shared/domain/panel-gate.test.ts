import { describe, expect, it } from 'vitest'
import type { GroundedEntry, ResolvedEntry } from '../../../shared/domain/grounding'
import {
  gateItems,
  gateRevision,
  initialGate,
  readyItems,
  type GateAction,
} from '../../../shared/domain/panelGate'

const pull = 12

function entry(id: string, changes: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    id,
    sources: [`f${id.slice(1)}`],
    verdict: 'legit',
    reason: 'The audit helper already does this.',
    evidence: ['src/audit.ts:4'],
    plan: `Plan for ${id}.`,
    destination: { kind: 'code', pull },
    resolution: 'agreed',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

const rejected = (id: string) =>
  entry(id, { verdict: 'notTrue', plan: undefined, reason: 'The guard is called.' })
const question = (id: string) =>
  entry(id, { verdict: 'authorsCall', plan: undefined, question: 'Is the limit per day?' })

function items(entries: ResolvedEntry[], actions: GateAction[]) {
  return gateItems(entries, { actions }, pull)
}

describe('the gate before Proceed', () => {
  it('starts with the agreed fixes ticked and their plans ready', () => {
    const entries = [entry('g1'), rejected('g2'), entry('g3', { resolution: 'unverified' })]

    const ready = readyItems(gateItems(entries, undefined, pull))

    expect(initialGate(entries).actions.map((action) => action.selected)).toEqual([
      true,
      false,
      false,
    ])
    expect(ready.map((item) => [item.entry.id, item.plan, item.route])).toEqual([
      ['g1', 'Plan for g1.', { kind: 'fix' }],
    ])
  })

  it('leaves a problem that was there before this PR for the author to pick up', () => {
    const entries = [entry('g1', { origin: 'exposed' }), entry('g2', { origin: 'preexisting' })]

    expect(initialGate(entries).actions.map((action) => action.selected)).toEqual([true, false])
  })

  it('keeps an overridden rejection from launching until the author writes its plan', () => {
    const entries = [rejected('g1')]

    const [blocked] = items(entries, [{ entry: 'g1', selected: true }])
    const [planned] = items(entries, [
      { entry: 'g1', selected: true, plan: 'Drop the guard.', planBy: 'author' },
    ])

    expect(blocked?.problem).toMatch(/rejected this finding/)
    expect(planned?.problem).toBeUndefined()
    expect(planned?.plan).toBe('Drop the guard.')
    expect(entries[0]?.verdict).toBe('notTrue')
  })

  it('blocks only the selected question that is unanswered', () => {
    const entries = [entry('g1'), question('g2')]

    const result = items(entries, [
      { entry: 'g1', selected: true },
      { entry: 'g2', selected: true },
    ])

    expect(result[1]?.problem).toBe('Answer the question first.')
    expect(readyItems(result).map((item) => item.entry.id)).toEqual(['g1'])
  })

  it('drops a planned answer’s plan once the answer is revised', () => {
    const planned: GateAction = {
      entry: 'g1',
      selected: true,
      answer: 'Per day.',
      plan: 'Count requests per day.',
      planBy: 'planner',
      plannedFrom: 'Per day.',
    }

    const [current] = items([question('g1')], [planned])
    const [revised] = items([question('g1')], [{ ...planned, answer: 'Per hour.' }])

    expect(current?.plan).toBe('Count requests per day.')
    expect(revised?.plan).toBeUndefined()
    expect(revised?.problem).toMatch(/answer changed/)
  })
})

describe('entries the models did not settle', () => {
  it('needs an explicit position on a disputed entry, and can take the other model’s plan', () => {
    const theirs: GroundedEntry = { ...entry('g9'), plan: 'Their plan.' }
    const disputed = entry('g1', {
      resolution: 'disputed',
      verdict: 'tasteSkip',
      plan: undefined,
      other: { role: 'secondary', entries: [theirs], objections: [] },
    })

    const [undecided] = items([disputed], [{ entry: 'g1', selected: true }])
    const [chosen] = items([disputed], [{ entry: 'g1', selected: true, choice: 'other' }])

    expect(undecided?.problem).toMatch(/choose a position/)
    expect(chosen?.plan).toBe('Their plan.')
    expect(chosen?.problem).toBeUndefined()
  })

  it('never sends an entry still missing evidence', () => {
    const open = entry('g1', { verdict: undefined, plan: undefined, missing: 'Production rows.' })

    const [item] = items(
      [open],
      [{ entry: 'g1', selected: true, plan: 'Guess.', planBy: 'author' }],
    )

    expect(item?.problem).toBe('It needs evidence before it can be fixed: Production rows.')
  })
})

describe('where a selected fix goes', () => {
  it('routes another layer’s code and a description change away from the fix thread', () => {
    const entries = [
      entry('g1', { destination: { kind: 'code', pull: 13 } }),
      entry('g2', { destination: { kind: 'metadata', pull, field: 'description' } }),
      entry('g3', { destination: { kind: 'unresolved', reason: 'Two layers touch it.' } }),
    ]

    const result = items(
      entries,
      entries.map((item) => ({ entry: item.id, selected: true })),
    )

    expect(result.map((item) => item.route)).toEqual([
      { kind: 'layer', pull: 13 },
      { kind: 'metadata', pull, field: 'description' },
      undefined,
    ])
    expect(result[2]?.problem).toBe('Where to make this change is unresolved: Two layers touch it.')
  })

  it('changes its revision when the author changes anything', () => {
    const before = gateRevision('f', { actions: [{ entry: 'g1', selected: true }] })

    expect(gateRevision('f', { actions: [{ entry: 'g1', selected: false }] })).not.toBe(before)
    expect(gateRevision('f', { actions: [{ entry: 'g1', selected: true }] })).toBe(before)
  })
})
