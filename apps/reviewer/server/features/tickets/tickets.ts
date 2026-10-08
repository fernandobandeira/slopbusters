import {
  linearMarkdown,
  type LinearStatus,
  type Ticket,
  type TicketView,
} from '../../../shared/domain/tickets'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitHub } from '../../adapters/github'
import { LinearError, type Linear } from '../../adapters/linear'
import { createCache } from '../../cache'
import { logError } from '../../errors'
import {
  MAX_TICKET_CACHE_ENTRIES,
  MAX_TICKET_CONTEXT_CHARACTERS,
  MAX_TICKET_RELATIVE_CHARACTERS,
  TICKET_TTL_MS,
} from '../../limits'
import * as queries from './linearQueries'
import { downloadTicket } from './ticketDownload'
import { createTicketLinks } from './ticketLinks'

export function createTicketService(linear: Linear, github: GitHub) {
  const tickets = createCache<Ticket>({ max: MAX_TICKET_CACHE_ENTRIES, ttlMs: TICKET_TTL_MS })
  const links = createTicketLinks(linear, github)

  async function list(view: TicketView, after?: string) {
    const result = await linear.request(
      queries.ticketListQuery,
      { filter: queries.ticketFilter(view), after: after ?? null },
      queries.ticketListSchema,
    )
    return {
      tickets: result.issues.nodes.map(queries.ticketSummary),
      next: result.issues.pageInfo.hasNextPage ? result.issues.pageInfo.endCursor : null,
    }
  }
  function get(identifier: string, options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    return tickets.load(
      identifier,
      () => downloadTicket({ linear, github }, identifier, options.signal),
      options.refresh,
    )
  }
  async function update(ticket: Ticket, changes: { title: string; description: string }) {
    const result = await linear.request(
      queries.updateTicketMutation,
      {
        id: ticket.id,
        input: { title: changes.title, description: linearMarkdown(changes.description) },
      },
      queries.updateTicketSchema,
      { mutation: true },
    )
    if (!result.issueUpdate.success)
      throw new LinearError('Linear did not save the issue. Retry in a moment.', 502, 'invalid')
    return get(ticket.identifier, { refresh: true })
  }
  /** Ticket evidence for PR reviewers, or nothing when Linear is not connected or unlinked. */
  async function contextForPull(pull: PullRequest, signal?: AbortSignal) {
    if (!linear.configured()) return undefined
    try {
      const identifier = await links.forPull(pull, signal)
      return identifier ? ticketContext(await get(identifier, { signal })) : undefined
    } catch (error) {
      signal?.throwIfAborted()
      logError('Loading the linked Linear issue for review', error)
      return undefined
    }
  }
  return {
    list,
    get,
    update,
    contextForPull,
    forPull: links.forPull,
    forPullUrl: links.forPullUrl,
    status: () => linearStatus(linear),
  }
}
export type TicketService = ReturnType<typeof createTicketService>

export function ticketContext(ticket: Ticket): string {
  return JSON.stringify({
    identifier: ticket.identifier,
    title: ticket.title,
    url: ticket.url,
    state: ticket.state.name,
    description: clip(ticket.description, MAX_TICKET_CONTEXT_CHARACTERS),
    parent: ticket.parentTicket && {
      identifier: ticket.parentTicket.identifier,
      title: ticket.parentTicket.title,
      state: ticket.parentTicket.state.name,
      description: clip(ticket.parentTicket.description, MAX_TICKET_RELATIVE_CHARACTERS),
    },
    children: ticket.children.map((child) => `${child.identifier}: ${child.title}`),
  })
}

export function clip(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n[Truncated at ${String(limit)} characters.]`
}

async function linearStatus(
  linear: Linear,
): Promise<Pick<LinearStatus, 'connected' | 'viewer' | 'detail'>> {
  if (!linear.configured())
    return { connected: false, viewer: null, detail: 'Connect Linear to review your issues.' }
  try {
    const { viewer } = await linear.request(queries.viewerQuery, {}, queries.viewerSchema)
    return { connected: true, viewer, detail: `Signed in as ${viewer.name}` }
  } catch (error) {
    return {
      connected: false,
      viewer: null,
      detail: error instanceof LinearError ? error.message : 'Linear could not be checked.',
    }
  }
}
