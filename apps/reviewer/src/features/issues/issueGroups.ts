import type { TicketSummary } from '../../../shared/domain/tickets'

export interface IssueGroup {
  /** Your issue, or the parent your sub-issues belong to when it isn't one of yours. */
  head: TicketSummary | NonNullable<TicketSummary['parent']>
  children: TicketSummary[]
}

/**
 * Nest each issue under its parent, as Linear's "My issues" does. Groups keep the order of their
 * most recently updated issue; siblings follow the parent's manual sub-issue order.
 */
export function issueGroups(tickets: TicketSummary[]): IssueGroup[] {
  const listed = new Map(tickets.map((ticket) => [ticket.identifier, ticket]))
  const groups = new Map<string, IssueGroup>()
  for (const ticket of tickets) {
    const key = ticket.parent?.identifier ?? ticket.identifier
    let group = groups.get(key)
    if (!group) {
      group = { head: listed.get(key) ?? ticket.parent ?? ticket, children: [] }
      groups.set(key, group)
    }
    if (ticket.parent) group.children.push(ticket)
  }
  for (const { children } of groups.values()) children.sort((a, b) => a.sortOrder - b.sortOrder)
  return [...groups.values()]
}

export function isListed(head: IssueGroup['head']): head is TicketSummary {
  return 'pullUrls' in head
}
