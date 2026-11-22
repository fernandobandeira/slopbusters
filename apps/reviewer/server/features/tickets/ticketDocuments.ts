import { linearMarkdown, type Ticket } from '../../../shared/domain/tickets'
import type { Linear } from '../../adapters/linear'
import { logError } from '../../errors'
import {
  MAX_TICKET_DOCUMENT_CHARACTERS,
  MAX_TICKET_DOCUMENT_TOTAL_CHARACTERS,
  MAX_TICKET_DOCUMENTS,
} from './limits'
import * as queries from './linearQueries'

interface DocumentLink {
  slugId: string
  issues: string[]
  id?: string
}

interface DocumentEvidence {
  title: string
  url: string
  issues: string[]
  content: string
}

export interface TicketDocuments {
  documents?: DocumentEvidence[]
  documentLimitations?: string
}

/** Discover metadata first, then fetch full content for only the selected documents. */
export async function readTicketDocuments(
  linear: Linear,
  ticket: Ticket,
  signal?: AbortSignal,
): Promise<TicketDocuments> {
  // The issue URL is supplied by Linear, using the same workspace credentials as these reads.
  const workspace = linearUrl(ticket.url)?.pathname.split('/')[1]
  const notes: string[] = []
  if (!workspace)
    return {
      documentLimitations: 'The connected issue’s Linear workspace could not be determined.',
    }
  const candidates = await discoverDocuments({ linear, workspace, notes, signal }, ticket)
  const selected = candidates.slice(0, MAX_TICKET_DOCUMENTS)
  const reads = await Promise.all(
    selected.map((link) => readDocument(linear, link, workspace, signal)),
  )
  const documents = limitContent(selected, reads, notes)
  const skipped = candidates.length - selected.length
  if (skipped)
    notes.push(
      `Linear documents skipped by the ${MAX_TICKET_DOCUMENTS}-document limit: ${skipped}.`,
    )
  return {
    ...(documents.length ? { documents } : {}),
    ...(notes.length ? { documentLimitations: notes.join(' ') } : {}),
  }
}

async function discoverDocuments(
  {
    linear,
    workspace,
    notes,
    signal,
  }: { linear: Linear; workspace: string; notes: string[]; signal?: AbortSignal },
  ticket: Ticket,
) {
  const links = new Map<string, DocumentLink>()
  const ids = new Map<string, DocumentLink>()
  for (const issue of [ticket, ticket.parentTicket]) {
    if (!issue) continue
    for (const document of linkedDocuments(issue.description, workspace))
      add(document, issue.identifier)
  }
  try {
    const { issue } = await linear.request(
      queries.ticketDocumentsQuery,
      { id: ticket.id, first: MAX_TICKET_DOCUMENTS + 1 },
      queries.ticketDocumentsSchema,
      { signal },
    )
    addAttached(ticket.identifier, issue.documents)
    if (issue.parent) addAttached(issue.parent.identifier, issue.parent.documents)
  } catch (error) {
    signal?.throwIfAborted()
    logError('Listing documents attached to the Linear issue and its parent', error)
    notes.push('Linear documents attached to the issue or its parent could not be listed.')
  }
  return [...new Set(links.values())]

  function add(document: Omit<DocumentLink, 'issues'>, identifier: string) {
    const existing = (document.id && ids.get(document.id)) || links.get(document.slugId)
    const link = existing ?? { ...document, issues: [] }
    if (!link.issues.includes(identifier)) link.issues.push(identifier)
    if (document.id) {
      link.id = document.id
      ids.set(document.id, link)
    }
    links.set(document.slugId, link)
  }

  function addAttached(
    identifier: string,
    connection: {
      nodes: { id: string; slugId: string; url: string }[]
      pageInfo: { hasNextPage: boolean }
    },
  ) {
    let invalid = 0
    for (const document of connection.nodes) {
      if (documentSlug(document.url, workspace) === document.slugId) {
        add({ id: document.id, slugId: document.slugId }, identifier)
      } else invalid++
    }
    if (invalid)
      notes.push(
        `Linear documents attached to ${identifier} skipped because of unexpected URLs: ${invalid}.`,
      )
    if (connection.pageInfo.hasNextPage)
      notes.push(
        `Additional Linear documents attached to ${identifier} were skipped by the ${MAX_TICKET_DOCUMENTS}-document limit.`,
      )
  }
}

function* linkedDocuments(description: string, workspace: string) {
  for (const [link] of description.matchAll(/https?:\/\/[^\s<>"'()[\]`]+/gi)) {
    const url = link.replace(/[.,;!?]+$/, '')
    const slugId = documentSlug(url, workspace)
    if (slugId) yield { slugId }
  }
}

function linearUrl(raw: string) {
  const url = URL.parse(raw)
  return url?.origin === 'https://linear.app' && !url.username && !url.password ? url : null
}

function documentSlug(raw: string, workspace: string) {
  const path = linearUrl(raw)?.pathname.replace(/\/$/, '').split('/')
  if (path?.length !== 4 || path[1] !== workspace || path[2] !== 'document') return undefined
  return /(?:^|-)([a-f0-9]{12})$/i.exec(path[3] ?? '')?.[1]?.toLowerCase()
}

async function readDocument(
  linear: Linear,
  link: DocumentLink,
  workspace: string,
  signal?: AbortSignal,
) {
  try {
    const { document } = await linear.request(
      queries.ticketDocumentQuery,
      { id: link.id ?? link.slugId },
      queries.ticketDocumentSchema,
      { signal },
    )
    if (
      documentSlug(document.url, workspace) !== link.slugId ||
      document.slugId !== link.slugId ||
      (link.id && document.id !== link.id)
    )
      throw new Error('Linear returned a different document.')
    return document
  } catch (error) {
    signal?.throwIfAborted()
    logError('Reading a Linear document for review', error)
    return undefined
  }
}

function limitContent(
  selected: DocumentLink[],
  reads: Awaited<ReturnType<typeof readDocument>>[],
  notes: string[],
): DocumentEvidence[] {
  let remaining = MAX_TICKET_DOCUMENT_TOTAL_CHARACTERS
  return selected.flatMap(({ slugId, issues }, index) => {
    const document = reads[index]
    const label = `Linear document ${slugId} (${issues.join(', ')})`
    if (document?.content == null) {
      notes.push(`${label} could not be read.`)
      return []
    }
    if (!remaining && document.content.length) {
      notes.push(
        `${label} was skipped by the ${MAX_TICKET_DOCUMENT_TOTAL_CHARACTERS}-character total.`,
      )
      return []
    }
    const limit = Math.min(remaining, MAX_TICKET_DOCUMENT_CHARACTERS)
    const content = linearMarkdown(document.content).slice(0, limit)
    remaining -= content.length
    if (content.length < document.content.length)
      notes.push(`${label} was clipped to ${limit} characters.`)
    return [{ title: document.title, url: document.url, issues, content }]
  })
}
