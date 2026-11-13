import { afterEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReviewerStore } from '../../../../server/adapters/store'
import type { Linear } from '../../../../server/adapters/linear'
import { UserError } from '../../../../server/errors'
import { PanelFollowups } from '../../../../server/features/panel/panelFollowups'
import * as queries from '../../../../server/features/panel/followUpQueries'
import { followUpSession } from '../../../fixtures/panelFollowups'

const directories: string[] = []
const stores: ReviewerStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const team = { id: 'team-chosen', name: 'Example Team', key: 'DEMO' }
const linked = {
  id: 'linked-issue',
  identifier: 'DEMO-10',
  url: 'https://linear.app/demo/issue/DEMO-10',
  team: { ...team, id: 'team-linked' },
}

function harness(
  options: { linked?: boolean; fail?: number; connected?: boolean; relationFails?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'followups-'))
  directories.push(directory)
  const store = new ReviewerStore({ dataDirectory: directory })
  stores.push(store)
  const saved = followUpSession()
  store.panel.save(saved)
  let creates = 0
  const requests: { query: string; variables: Record<string, unknown>; options: unknown }[] = []
  const linear: Linear = {
    configured: () => options.connected !== false,
    request: <T>(
      query: string,
      variables: Record<string, unknown>,
      schema: z.ZodType<T>,
      requestOptions?: unknown,
    ) => {
      requests.push({ query, variables, options: requestOptions })
      let data: unknown
      if (query === queries.viewerQuery)
        data = {
          viewer: {
            id: 'viewer-id',
            teams: { nodes: [team], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        }
      else if (query === queries.linkedQuery) data = { issue: linked }
      else if (query === queries.relateMutation)
        data = { issueRelationCreate: { success: !options.relationFails } }
      else {
        creates++
        if (creates === options.fail) return Promise.reject(new Error('Linear unavailable'))
        // A gate saved while Linear was creating must survive the response.
        const latest = store.panel.get(saved.id)!
        latest.results[0]!.gate = { actions: [{ entry: 'g1', selected: false, answer: 'Later.' }] }
        store.panel.save(latest)
        data = {
          issueCreate: {
            success: true,
            issue: {
              id: `created-${String(creates)}`,
              identifier: `DEMO-${String(20 + creates)}`,
              url: `https://linear.app/demo/issue/DEMO-${String(20 + creates)}`,
            },
          },
        }
      }
      return Promise.resolve(schema.parse(data))
    },
  }
  const service = new PanelFollowups({
    store: store.panel,
    linear,
    linked: () => Promise.resolve(options.linked ? linked.identifier : null),
  })
  const input = { url: saved.urls[0]!, entries: ['g1', 'g2'], team: team.id }
  return { service, store, saved, input, requests }
}

describe('filing panel follow-ups', () => {
  it('uses the linked team and viewer, sends exact writes, and preserves newer choices', async () => {
    const { service, saved, input, requests } = harness({ linked: true })
    const reply = await service.file(saved.id, { ...input, entries: ['g1'] })
    expect(reply.failures).toEqual([])
    expect(reply.session.results[0]!.gate?.actions[0]?.answer).toBe('Later.')
    const writes = requests.filter((request) => request.options)
    expect(writes[0]).toEqual({
      query:
        'mutation SlopbustersFollowUp($input: IssueCreateInput!) {\n  issueCreate(input: $input) { success issue { id identifier url } }\n}',
      variables: {
        input: {
          title: 'Retain the audit row',
          description: [
            `[src/audit.ts:4](https://github.com/${saved.results[0]!.pull.owner}/${saved.results[0]!.pull.repo}/blob/${saved.results[0]!.pull.headSha}/src/audit.ts#L4)`,
            'Deferred from the PR: Already there before this change; leave it for a follow-up.',
            'Grounded reason: The retry can lose the audit row.',
            'Plan: Persist the row before retrying.',
            `From: ${input.url}`,
            'Related ticket: [DEMO-10](https://linear.app/demo/issue/DEMO-10)',
            '+++ Agent notes',
            'Retain the audit row\n\na reviewer: the retry loses the row.\n\nPersist the row before retrying.',
            '+++',
          ].join('\n\n'),
          teamId: 'team-linked',
          assigneeId: 'viewer-id',
        },
      },
      options: { mutation: true },
    })
    expect(writes[1]).toEqual({
      query:
        'mutation SlopbustersRelateFollowUp($input: IssueRelationCreateInput!) {\n  issueRelationCreate(input: $input) { success }\n}',
      variables: {
        input: { issueId: 'created-1', relatedIssueId: 'linked-issue', type: 'related' },
      },
      options: { mutation: true },
    })
    const description = (writes[0]!.variables.input as { description: string }).description
    expect(description).toContain('+++ Agent notes')
    expect(description).toContain('Already there before this change')
    expect(description).toContain('Grounded reason: The retry can lose the audit row.')
    expect(description).toContain('Plan: Persist the row before retrying.')
    expect(description).toContain(`/blob/${saved.results[0]!.pull.headSha}/`)
    expect(description).toContain(saved.urls[0])
    expect(description).toContain('[DEMO-10]')
    expect(description).not.toContain('Example Reviewer')
    expect(reply.session.results[0]!.followUps).toEqual([
      expect.objectContaining({
        entry: 'g1',
        identifier: 'DEMO-21',
        filedAt: expect.any(String) as unknown,
      }),
    ])
  })
})

describe('follow-up filing choices and failures', () => {
  it('exposes viewer teams, uses the picked team, and requires a valid choice', async () => {
    const { service, saved, input, requests } = harness()
    expect(await service.choices(saved.id, input.url)).toEqual({ teams: [team], linked: null })
    await expect(service.file(saved.id, { ...input, team: 'unknown' })).rejects.toThrow(
      'Choose a Linear team',
    )
    await service.file(saved.id, { ...input, entries: ['g1'] })
    expect(
      requests.find((request) => request.query === queries.createMutation)?.variables,
    ).toMatchObject({ input: { teamId: team.id, assigneeId: 'viewer-id' } })
    expect(requests.some((request) => request.query === queries.relateMutation)).toBe(false)
  })

  it('returns existing tickets on duplicate and concurrent filing without creating twice', async () => {
    const { service, saved, input, requests } = harness()
    await Promise.all([service.file(saved.id, input), service.file(saved.id, input)])
    const reply = await service.file(saved.id, { ...input, team: undefined })
    expect(reply.session.results[0]!.followUps).toHaveLength(2)
    expect(requests.filter((request) => request.query === queries.createMutation)).toHaveLength(2)
  })

  it('keeps successes on partial failure and retries only missing tickets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, saved, input, requests } = harness({ fail: 2 })
    const reply = await service.file(saved.id, input)
    expect(reply.failures).toEqual([
      { entry: 'g2', message: expect.stringContaining('Linear could not file') as unknown },
    ])
    expect(reply.session.results[0]!.followUps).toHaveLength(1)
    const retry = await service.file(saved.id, input)
    expect(retry.session.results[0]!.followUps).toHaveLength(2)
    expect(requests.filter((request) => request.query === queries.createMutation)).toHaveLength(3)
  })

  it('files the ticket and only logs when Linear cannot relate it to the linked one', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, saved, input } = harness({ linked: true, relationFails: true })
    const reply = await service.file(saved.id, { ...input, entries: ['g1'] })
    expect(reply.session.results[0]!.followUps).toHaveLength(1)
    expect(reply.failures).toEqual([])
    expect(logged).toHaveBeenCalled()
  })

  it('requires Linear and rejects findings that are not follow-ups', async () => {
    const disconnected = harness({ connected: false })
    await expect(
      disconnected.service.file(disconnected.saved.id, disconnected.input),
    ).rejects.toBeInstanceOf(UserError)
    await expect(
      disconnected.service.choices(disconnected.saved.id, disconnected.input.url),
    ).rejects.toThrow('Connect Linear in Settings')
    expect(disconnected.requests).toHaveLength(0)
    const { service, saved, input, store, requests } = harness()
    saved.results[0]!.grounding!.resolved![0]!.verdict = 'notTrue'
    store.panel.save(saved)
    await expect(service.file(saved.id, input)).rejects.toThrow('Choose only findings')
    expect(requests).toHaveLength(0)
  })
})
