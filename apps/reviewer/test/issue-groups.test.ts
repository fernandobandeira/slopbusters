import { describe, expect, it } from 'vitest'
import type { TicketSummary } from '../shared/domain/tickets'
import { issueGroups } from '../src/features/issues/issueGroups'
import { required } from './fixtures/bob'
import { fixtureTicket } from './fixtures/tickets'

function issue(identifier: string, changes: Partial<TicketSummary> = {}): TicketSummary {
  return { ...fixtureTicket(), identifier, ...changes }
}

describe('issue groups', () => {
  it('nests sub-issues under their parent in Linear order, listed or not', () => {
    const parent = issue('SCH-750', { parent: null })
    const reference = { ...required(fixtureTicket().parent), identifier: 'SCH-900' }
    const tickets = [
      issue('SCH-762', { sortOrder: 3 }),
      issue('SCH-901', { parent: reference }),
      issue('SCH-761', { sortOrder: 1 }),
      parent,
      issue('SCH-800', { parent: null }),
    ]

    const groups = issueGroups(tickets)

    expect(
      groups.map((group) => [
        group.head.identifier,
        group.children.map((child) => child.identifier),
      ]),
    ).toEqual([
      ['SCH-750', ['SCH-761', 'SCH-762']],
      ['SCH-900', ['SCH-901']],
      ['SCH-800', []],
    ])
    expect(groups[0]?.head).toBe(parent)
    expect(groups[1]?.head).toBe(reference)
  })
})
