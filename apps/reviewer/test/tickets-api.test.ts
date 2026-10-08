import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { Linear } from '../server/adapters/linear'
import type { GitHub } from '../server/adapters/github'
import { startReviewerServer } from '../server/app'
import { fixtureTicket } from './fixtures/tickets'

vi.mock('../server/adapters/reviewWorkspaces', () => ({
  ReviewWorkspaces: class {
    close() {
      return Promise.resolve()
    }
  },
}))

const ticket = fixtureTicket()
function issueNode() {
  return {
    ...ticket,
    assignee: { name: 'Avery Example' },
    project: null,
    labels: { nodes: [{ name: 'ready-for-agent' }] },
    parent: { identifier: 'SCH-750' },
    attachments: { nodes: [{ url: 'https://github.com/acme/app/pull/9' }] },
    parentTicket: ticket.parentTicket,
    children: { nodes: [] },
  }
}
const linear: Linear = {
  configured: () => true,
  request: <T>(query: string, _variables: Record<string, unknown>, schema: z.ZodType<T>) =>
    Promise.resolve(
      schema.parse(
        query.includes('SlopbustersTickets')
          ? { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } }
          : query.includes('SlopbustersViewer')
            ? { viewer: { name: 'Avery Example', email: 'avery@example.com' } }
            : { issue: issueNode() },
      ),
    ),
}
const github = {
  rest: () => Promise.resolve({ title: 'Collect deposits', state: 'open', merged: false }),
  paginate: () => Promise.resolve([]),
  graphql: () => Promise.resolve({}),
} as unknown as GitHub

describe('ticket API', () => {
  it('lists issues, loads one with its PRs, and keeps credentials out of preferences', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tickets-api-'))
    const app = await startReviewerServer({
      dataDirectory: directory,
      staticDirectory: directory,
      port: 0,
      linear,
      github,
    })
    try {
      const list = (await (await fetch(`${app.url}/api/tickets?view=assigned`)).json()) as {
        tickets: { identifier: string; pullUrls: string[] }[]
      }
      expect(list.tickets).toEqual([
        expect.objectContaining({
          identifier: 'SCH-760',
          pullUrls: ['https://github.com/acme/app/pull/9'],
        }),
      ])
      const invalid = await fetch(`${app.url}/api/tickets/sch-760`)
      expect(invalid.status).toBe(400)
      const issue = (await (await fetch(`${app.url}/api/tickets/SCH-760`)).json()) as {
        pulls: { repository: string; state: string }[]
      }
      expect(issue.pulls).toEqual([
        expect.objectContaining({ repository: 'acme/app', state: 'open' }),
      ])
      const status = (await (await fetch(`${app.url}/api/linear/status`)).json()) as unknown
      expect(status).toMatchObject({ connected: true, oauthAvailable: true, method: 'none' })

      const saved = await fetch(`${app.url}/api/linear/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'lin_api_secret_value' }),
      })
      expect(saved.status).toBe(200)
      const preferences = await (await fetch(`${app.url}/api/preferences`)).text()
      expect(preferences).not.toContain('lin_api_secret_value')
      expect(
        await (await fetch(`${app.url}/api/ticket-reviews/latest?ticket=SCH-760`)).json(),
      ).toEqual({
        session: null,
      })
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
