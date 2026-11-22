import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { GitHub } from '../../../../server/adapters/github'
import type { Linear } from '../../../../server/adapters/linear'
import { ticketEvidence } from '../../../../server/features/jobs/ticketEvidence'
import { TicketReviewJobs } from '../../../../server/features/jobs/ticketReviewJobs'
import { LinusJobs } from '../../../../server/features/linus/linusJobs'
import {
  MAX_TICKET_DOCUMENT_CHARACTERS,
  MAX_TICKET_DOCUMENT_TOTAL_CHARACTERS,
  MAX_TICKET_DOCUMENTS,
} from '../../../../server/features/tickets/limits'
import * as queries from '../../../../server/features/tickets/linearQueries'
import { createTicketService } from '../../../../server/features/tickets/tickets'
import type { LinusAdvice } from '../../../../shared/domain/linus'
import type { Ticket } from '../../../../shared/domain/tickets'
import {
  companion,
  isGrounding,
  panelHarness,
  primary,
  reply,
  repository,
  url,
} from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { fixtureJobsAdvice, fixtureTicket } from '../../../fixtures/tickets'
import { recordingTurns } from '../../../fixtures/turns'

const github: GitHub = {
  rest: () => Promise.reject(new Error('Unexpected GitHub request')),
  graphql: () => Promise.reject(new Error('Unexpected GitHub request')),
  paginate: () => Promise.reject(new Error('Unexpected GitHub request')),
}

function spec(number: number, content = '>>> Transfer deadline\nAllow a week.\n>>>') {
  const slugId = number.toString(16).padStart(12, '0')
  return {
    id: `document-uuid-${number}`,
    slugId,
    title: `Transfer spec ${number}`,
    url: `https://linear.app/clinic/document/transfer-spec-${slugId}`,
    content,
  }
}

function ticketWithLinks(...urls: string[]) {
  return fixtureTicket({
    description: `Collect transfers.\n${urls.map((url) => `[Spec](${url})`).join('\n')}`,
  })
}

function fakeLinear(options: {
  ticket: Ticket
  documents: ReturnType<typeof spec>[]
  attachedToParent?: ReturnType<typeof spec>[]
  moreAttached?: boolean
  attachmentsUnavailable?: boolean
}) {
  const { ticket, documents, attachedToParent = [], moreAttached = false } = options
  const reads: unknown[] = []
  const issueNode = {
    ...ticket,
    subIssueSortOrder: null,
    assignee: null,
    labels: { nodes: [] },
    parent: ticket.parent && { ...ticket.parent, children: { nodes: [] } },
    children: { nodes: [] },
    subIssues: { nodes: [] },
    attachments: { nodes: [] },
    inverseRelations: { nodes: [] },
    relations: { nodes: [] },
  }
  const linear: Linear = {
    configured: () => true,
    async request(query, variables, schema) {
      await Promise.resolve()
      if (query === queries.ticketByAttachmentQuery)
        return schema.parse({ attachmentsForURL: { nodes: [{ issue: ticket }] } })
      if (query === queries.ticketQuery) return schema.parse({ issue: issueNode })
      if (query === queries.ticketDocumentsQuery) {
        if (options.attachmentsUnavailable) throw new Error('Issue.documents unavailable')
        expect(variables).toEqual({ id: ticket.id, first: MAX_TICKET_DOCUMENTS + 1 })
        const connection = (nodes: typeof documents, hasNextPage: boolean) => ({
          nodes,
          pageInfo: { hasNextPage },
        })
        return schema.parse({
          issue: {
            documents: connection([], false),
            parent: ticket.parent && {
              identifier: ticket.parent.identifier,
              documents: connection(attachedToParent, moreAttached),
            },
          },
        })
      }
      if (query !== queries.ticketDocumentQuery) throw new Error('Unexpected Linear query')
      reads.push(variables.id)
      const document = documents.find((doc) => [doc.id, doc.slugId].includes(String(variables.id)))
      if (!document) throw new Error('Document unavailable')
      return schema.parse({ document })
    },
  }
  return { tickets: createTicketService(linear, github), reads }
}

const evidenceSchema = z.object({
  description: z.string(),
  documents: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        issues: z.array(z.string()),
        content: z.string(),
      }),
    )
    .optional(),
  documentLimitations: z.string().optional(),
})

describe('Linear documents used as ticket evidence', () => {
  it('deduplicates linked and attached documents and keeps every source issue', async () => {
    const linked = spec(1)
    const attached = spec(2)
    const parentLinked = spec(3)
    const ticket = ticketWithLinks(linked.url, `${linked.url}?view=full`)
    if (ticket.parentTicket)
      ticket.parentTicket.description = `<document href="${parentLinked.url}">Parent spec</document>`
    const { tickets, reads } = fakeLinear({
      ticket,
      documents: [linked, attached, parentLinked],
      attachedToParent: [linked, attached],
    })

    const context = await tickets.contextForPull(fixturePull())
    const evidence = evidenceSchema.parse(JSON.parse(context?.text ?? ''))
    expect(evidence.documents).toEqual([
      {
        title: linked.title,
        url: linked.url,
        issues: ['SCH-760', 'SCH-750'],
        content: '+++ Transfer deadline\nAllow a week.\n+++',
      },
      {
        title: parentLinked.title,
        url: parentLinked.url,
        issues: ['SCH-750'],
        content: '+++ Transfer deadline\nAllow a week.\n+++',
      },
      {
        title: attached.title,
        url: attached.url,
        issues: ['SCH-750'],
        content: '+++ Transfer deadline\nAllow a week.\n+++',
      },
    ])
    expect(reads).toEqual([linked.id, parentLinked.slugId, attached.id])
    expect(context?.limitation).toBeUndefined()
  })

  it('bounds document count and text and discloses clipped documents and skipped pages', async () => {
    const documents = Array.from({ length: MAX_TICKET_DOCUMENTS + 1 }, (_, index) =>
      spec(index + 1, 'x'.repeat(MAX_TICKET_DOCUMENT_CHARACTERS + 1)),
    )
    const { tickets, reads } = fakeLinear({
      ticket: fixtureTicket(),
      documents,
      attachedToParent: documents,
      moreAttached: true,
    })

    const context = await tickets.contextForPull(fixturePull())
    const evidence = evidenceSchema.parse(JSON.parse(context?.text ?? ''))
    const lengths = evidence.documents?.map((document) => document.content.length)
    expect(lengths).toEqual([
      MAX_TICKET_DOCUMENT_CHARACTERS,
      MAX_TICKET_DOCUMENT_TOTAL_CHARACTERS - MAX_TICKET_DOCUMENT_CHARACTERS,
    ])
    expect(reads).toHaveLength(MAX_TICKET_DOCUMENTS)
    expect(context?.limitation).toContain('was clipped to 32000 characters')
    expect(context?.limitation).toContain('was clipped to 16000 characters')
    expect(context?.limitation).toContain('was skipped by the 48000-character total')
    expect(context?.limitation).toContain('Linear documents skipped by the 3-document limit: 1.')
    expect(context?.limitation).toContain(
      'Additional Linear documents attached to SCH-750 were skipped',
    )
    expect(evidence.documentLimitations).toBe(context?.limitation)
  })
})

describe('unavailable Linear documents', () => {
  it('still reads same-workspace links when attachment discovery fails', async () => {
    const linked = spec(1)
    const { tickets } = fakeLinear({
      ticket: ticketWithLinks(linked.url),
      documents: [linked],
      attachmentsUnavailable: true,
    })
    const context = await tickets.contextForPull(fixturePull())

    expect(context?.text).toContain(linked.title)
    expect(context?.limitation).toContain('could not be listed')
  })

  it('keeps the issue when a document fails and never fetches outside links', async () => {
    const missing = spec(1)
    const external = spec(2).url.replace('linear.app', 'notion.so')
    const otherWorkspace = spec(3).url.replace('/clinic/', '/another-workspace/')
    const { tickets, reads } = fakeLinear({
      ticket: ticketWithLinks(missing.url, external, otherWorkspace),
      documents: [],
    })

    const context = await tickets.contextForPull(fixturePull())
    const evidence = evidenceSchema.parse(JSON.parse(context?.text ?? ''))
    expect(reads).toEqual([missing.slugId])
    expect(evidence.description).toContain('Collect transfers.')
    expect(evidence.description).toContain(external)
    expect(evidence.description).toContain(otherWorkspace)
    expect(evidence.documents).toBeUndefined()
    expect(evidence.documentLimitations).toContain(`${missing.slugId} (SCH-760) could not be read`)
  })
})

const harness = panelHarness()
const linusAdvice: LinusAdvice = {
  verdict: 'keep',
  reasoning: 'One logical change.',
  revisedTitle: '',
  revisedDescription: '',
  layers: [],
  limitations: [],
  disagreements: [],
  steps: [{ text: 'Keep it together.', emotion: 'happy', target: 'overview', reference: '' }],
}

function reviewTickets() {
  const document = spec(1)
  const missing = spec(2)
  const { tickets } = fakeLinear({
    ticket: ticketWithLinks(document.url, missing.url),
    documents: [document],
  })
  return {
    tickets,
    document,
    limitation: `Linear document ${missing.slugId} (SCH-760) could not be read.`,
  }
}

function expectDocument(prompt: string, document: ReturnType<typeof spec>, limitation: string) {
  expect(prompt).toMatch(/Linear documents.*untrusted evidence/)
  expect(prompt).toContain(
    JSON.stringify({
      title: document.title,
      url: document.url,
      issues: ['SCH-760'],
      content: '+++ Transfer deadline\nAllow a week.\n+++',
    }),
  )
  expect(prompt).toContain(limitation)
}

describe('document evidence in reviewer prompts and results', () => {
  it('reaches the panel seat and grounding, and saves the evidence limitation', async () => {
    const { tickets, document, limitation } = reviewTickets()
    const { turns, requests } = recordingTurns(reply)
    const panel = harness.panel(turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      context: tickets.contextForPull,
    })

    const session = await panel.start(repository, [url], ['unclebob'])
    await vi.waitFor(() => {
      expect(panel.get(session.id).status).toBe('complete')
    })

    expect(requests.some(isGrounding)).toBe(true)
    expect(requests.some((request) => !isGrounding(request))).toBe(true)
    for (const { prompt } of requests) expectDocument(prompt, document, limitation)
    expect(panel.get(session.id).results[0]?.advice.limitations).toContain(limitation)
  })

  it('reaches both Linus reviewers and reconciliation, and saves the evidence limitation', async () => {
    const { tickets, document, limitation } = reviewTickets()
    const { turns, requests } = recordingTurns(() => linusAdvice)
    harness.store.savePreferences({ organization: primary, companion })
    await writeFile(join(harness.data, 'linus-skill.md'), 'Linus skill')
    const linus = new LinusJobs({
      store: harness.store,
      turns,
      staticDirectory: harness.data,
      loadPull: () => Promise.resolve(fixturePull()),
      context: tickets.contextForPull,
    })

    try {
      const session = linus.start(repository, [url])
      await vi.waitFor(() => {
        expect(linus.get(session.id).status).toBe('complete')
      })
      expect(requests.map((request) => request.purpose?.split(' · ')[0])).toEqual([
        'Linus primary review',
        'Linus companion review',
        'Linus reconciliation',
      ])
      for (const { prompt } of requests) expectDocument(prompt, document, limitation)
      expect(linus.get(session.id).results[0]?.advice.limitations).toContain(limitation)
    } finally {
      await linus.close()
    }
  })

  it('reaches both Jobs reviewers and reconciliation, and saves the evidence limitation', async () => {
    const { tickets, document, limitation } = reviewTickets()
    const { turns, requests } = recordingTurns(() => fixtureJobsAdvice({ findings: [] }))
    harness.store.savePreferences({ organization: primary, companion })
    await writeFile(join(harness.data, 'jobs-skill.md'), 'Jobs skill')
    const jobs = new TicketReviewJobs({
      store: harness.store,
      turns,
      staticDirectory: harness.data,
      tickets,
      evidence: (ticket, signal) =>
        ticketEvidence({ github, documentsForTicket: tickets.documentsForTicket }, ticket, signal),
    })

    try {
      const session = jobs.start('SCH-760')
      await vi.waitFor(() => {
        expect(jobs.get(session.id).status).toBe('complete')
      })
      expect(requests.map((request) => request.purpose?.split(' · ')[0])).toEqual([
        'Jobs primary review',
        'Jobs companion review',
        'Jobs reconciliation',
      ])
      for (const { prompt } of requests) expectDocument(prompt, document, limitation)
      expect(jobs.get(session.id).revisions[0]?.advice.limitations).toContain(limitation)
    } finally {
      await jobs.close()
    }
  })
})
