import { describe, expect, it } from 'vitest'
import type { Consistency, EarlierRequest } from '../../../shared/domain/consistency'
import { markEntries } from '../../../shared/domain/groundingResult'
import { panelBriefMarkdown } from '../../../shared/domain/panelBrief'
import { initialGate } from '../../../shared/domain/panelGate'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import { stackPassInput } from '../../../shared/domain/stackPassInput'
import { triage } from '../../../shared/domain/triage'
import { groundedEntry, groundedResult, groundedSource } from '../../fixtures/grounding'
import { finishedStackReview, layerUrl, stackRepository } from '../../fixtures/stackReview'

/**
 * Round 3 of a stack reviewed three times: one teammate's taste would undo the single field
 * round 2 asked for, a rule raised by several seats would move a read round 2 embedded back out,
 * and two seats of one teammate ask for opposite changes to the same flag.
 */
const round2: EarlierRequest[] = [
  {
    key: 'e1',
    round: '2026-11-18',
    entry: '#201/g4',
    title: 'Express the access level in one field',
    plan: 'Replace the two booleans with one access level per method.',
    reason: 'Two booleans permit a contradictory fourth combination.',
    asked: 'fix',
  },
  {
    key: 'e2',
    round: '2026-11-18',
    entry: '#201/g5',
    title: 'Read the account with the invoice',
    plan: 'Select the account inside the invoice query and drop the later lookup.',
    reason: 'The later lookup misses accounts closed in between.',
    asked: 'fix',
  },
]
const check: Consistency = {
  reversals: [
    { entry: 'g1', earlier: 'e1', reason: 'It brings back the two booleans e1 replaced.' },
    { entry: 'g2', earlier: 'e2', reason: 'It moves the account read back out of the query.' },
  ],
  conflicts: [
    {
      entries: ['g3', 'g4'],
      reason: 'One folds the portal flag into the generic one; the other splits it out.',
    },
  ],
}
const resolved = markEntries(
  [
    groundedEntry('g1', 'f1', {
      verdict: 'predicted',
      kind: 'simplification',
      effort: 'small',
      impact: 'behavior',
      plan: 'Remove the access level and define two booleans on each method.',
      reason: 'One field keeps the impossible combination out.',
      raisedBy: ['teammate:quinn'],
    }),
    groundedEntry('g2', 'f2', {
      kind: 'rule',
      effort: 'small',
      impact: 'behavior',
      plan: 'Read the account through the accounts service, batched per page.',
      raisedBy: ['teammate:quinn', 'terminator'],
    }),
    groundedEntry('g3', 'f3', {
      plan: 'Remove canEditInPortal and reuse allowsStateChanges.',
      raisedBy: ['teammate:quinn'],
    }),
    groundedEntry('g4', 'f4', {
      plan: 'Add an explicit portal property for the cancel rule.',
      raisedBy: ['teammate:quinn'],
    }),
    groundedEntry('g5', 'f5', { plan: 'Handle the empty page.' }),
  ],
  check,
)
const result = groundedResult(resolved, {
  number: 201,
  earlier: { requests: round2, left: 0 },
  candidates: [
    groundedSource('f1', 'Do we need the access level type?', 'teammate:quinn', 201),
    groundedSource('f2', 'Keep the account read in the accounts service', 'terminator', 201),
    groundedSource('f3', 'Fold the portal flag into the generic one', 'teammate:quinn', 201),
    groundedSource('f4', 'Split a portal flag out of the generic one', 'teammate:quinn', 201),
    groundedSource('f5', 'Handle the empty page', 'unclebob', 201),
  ],
})

describe('a round that would undo what an earlier round asked for', () => {
  it('puts every marked entry to the author first, even a small prediction or a shared rule', () => {
    expect(
      resolved.map((entry) => [entry.id, triage(entry).disposition, triage(entry).reason]),
    ).toEqual([
      ['g1', 'ask', 'Would undo a change an earlier round asked for.'],
      ['g2', 'ask', 'Would undo a change an earlier round asked for.'],
      ['g3', 'ask', 'Another finding asks for the opposite change.'],
      ['g4', 'ask', 'Another finding asks for the opposite change.'],
      ['g5', 'fix', 'Corrects a confirmed defect.'],
    ])
    expect(resolved.every((entry) => entry.id === 'g5' || triage(entry).rank === 0)).toBe(true)
    expect(
      initialGate(resolved)
        .actions.filter((a) => a.selected)
        .map((a) => a.entry),
    ).toEqual(['g5'])
  })

  it('briefs each as one decision naming what it is against, and none as a fix', () => {
    const brief = panelBriefMarkdown(result, [])
    const chosen = brief.slice(
      brief.indexOf('## The fixes the author chose'),
      brief.indexOf('## Needs your decision'),
    )
    const decisions = brief.slice(brief.indexOf('## Needs your decision'))

    expect(chosen).toContain('Handle the empty page')
    expect(chosen).not.toMatch(/access level|account read|portal flag/)
    expect(brief).not.toContain('## Predicted reviewer comments')
    expect(decisions).toContain(
      'Would undo what an earlier round asked for: #201/g4 from the round of 2026-11-18, "Express the access level in one field": Replace the two booleans with one access level per method. Its reason: Two booleans permit a contradictory fourth combination.',
    )
    expect(decisions).toContain('The check found: It moves the account read back out of the query.')
    expect(decisions).toContain(
      'Reply if the code stays: One field keeps the impossible combination out.',
    )
    expect(decisions.match(/\*\*Opposed changes\*\*/g)).toHaveLength(1)
    expect(decisions).toContain(
      '**Split a portal flag out of the generic one** (g4, raised by teammate:quinn): Add an explicit portal property for the cancel rule.',
    )
  })

  it('makes the same decisions in the stack brief', () => {
    const input = stackPassInput(
      [{ layer: { number: 201, title: 'Layer 201', url: layerUrl(201) }, current: result }],
      1_000_000,
    )
    const session = finishedStackReview(input.entries)

    const brief = stackBrief(session)
    const markdown = stackBriefMarkdown(brief!, stackRepository)

    expect(brief?.fixes.flatMap(({ items }) => items.map((item) => item.id))).toEqual(['#201/g5'])
    expect(brief?.decisions.map((item) => item.id)).toEqual(['#201/g1', '#201/g2', '#201/g3'])
    expect(brief?.decisions[0]?.question).toBe(
      'It would undo what the round of 2026-11-18 asked for in #201/g4, "Express the access level in one field": Replace the two booleans with one access level per method. (Two booleans permit a contradictory fourth combination.) The check found: It brings back the two booleans e1 replaced. The models would not ask for it; reply if the code stays: One field keeps the impossible combination out. Undo the earlier change, or keep it?',
    )
    expect(brief?.decisions[2]).toMatchObject({
      title:
        'Opposed changes: Fold the portal flag into the generic one / Split a portal flag out of the generic one',
      why: 'Another finding asks for the opposite change.',
    })
    expect(markdown).toContain('Which one, if either? #201/g3 (Fold the portal flag')
  })
})
