import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ReviewerStore } from '../../../server/adapters/store'
import { startReviewerServer } from '../../../server/app'
import { routeUrl, type ApiContract, type CallInput } from '../../../shared/api/contract'
import * as routes from '../../../shared/api/stackReviewRecords'
import { finishedStackReview, layerUrl, stackEntry } from '../../fixtures/stackReview'

const stack = finishedStackReview([
  stackEntry(201, 'default', { disposition: 'ask', verdict: 'predicted' }),
  stackEntry(201, 'independent', { disposition: 'ask', verdict: 'predicted' }),
  stackEntry(202, 'stale', { disposition: 'ask', verdict: 'predicted' }),
  stackEntry(203, 'serious', { disposition: 'ask', verdict: 'predicted', impact: 'money' }),
])
const decision = { decisionId: '#201/default', expectedRevision: 0, optionId: 'keep' }
const independent = { decisionId: '#201/independent', expectedRevision: 0, optionId: 'keep' }
const noGitHub = () => Promise.reject(new Error('Unexpected GitHub request'))
let directory: string
let app: Awaited<ReturnType<typeof startReviewerServer>>
let agent: Client | undefined
let moveFirst: boolean

beforeEach(async () => {
  moveFirst = false
  directory = mkdtempSync(join(tmpdir(), 'review-records-'))
  const store = new ReviewerStore({ dataDirectory: directory })
  store.stackReview.save(stack)
  store.stackReview.save({ ...stack, id: 'stack-2', createdAt: '2026-11-15T10:00:00.000Z' })
  store.close()
  app = await startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    mcp: { port: 0 },
    github: {
      rest: (endpoint) => {
        const layer = stack.layers.find(({ number }) => endpoint.endsWith(`/pulls/${number}`))
        if (!layer) return noGitHub()
        return Promise.resolve({
          state: 'open',
          head: { sha: layer.headSha },
          base: {
            sha:
              layer.number === 202 || (layer.number === 201 && moveFirst) ? 'moved' : layer.baseSha,
          },
        })
      },
      graphql: noGitHub,
      paginate: noGitHub,
    },
  })
})
afterEach(async () => {
  await agent?.close()
  agent = undefined
  await app.close()
  rmSync(directory, { recursive: true, force: true })
})

function request<C extends ApiContract>(route: C, input: CallInput<C>) {
  return fetch(app.url + routeUrl(route, input), {
    method: route.method,
    headers: { 'Content-Type': 'application/json' },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
}
const params = { id: stack.id }

async function records(id = stack.id) {
  const result = await request(routes.getStackRecords, { params: { id } })
  expect(result.status).toBe(200)
  return routes.getStackRecords.response.parse(await result.json()).records
}

it('uses compare-and-swap for answers and reopens, preserving the tombstone revision', async () => {
  const save = (optionId: string) =>
    request(routes.putStackAnswer, {
      params,
      body: {
        decisionId: decision.decisionId,
        expectedRevision: 0,
        answer: { state: 'chosen', optionId, note: 'Private' },
      },
    })
  expect((await save('bogus')).status).toBe(400)
  const results = await Promise.all([save('keep'), save('change')])
  expect(results.map(({ status }) => status).sort()).toEqual([200, 409])
  const [saved] = await records()
  expect(saved).toMatchObject({ revision: 1, answer: { note: 'Private' } })
  expect(
    (
      await request(routes.reopenStackAnswer, {
        params,
        body: { decisionId: decision.decisionId, expectedRevision: 1 },
      })
    ).status,
  ).toBe(200)
  expect(await records()).toMatchObject([{ revision: 2, answer: null }])
  expect((await save('change')).status).toBe(409)
})

it('rejects ineligible bulk choices and rolls back a stale request without touching another card', async () => {
  const bulk = (answers: routes.BulkWrite) =>
    request(routes.putStackAnswers, { params, body: { answers } })
  expect((await bulk([decision, { ...decision, decisionId: '#202/stale' }])).status).toBe(400)
  expect((await bulk([decision, { ...decision, decisionId: '#203/serious' }])).status).toBe(400)
  expect(await records()).toEqual([])
  expect((await bulk([decision])).status).toBe(200)
  expect((await bulk([independent, decision])).status).toBe(409)
  expect((await bulk([{ ...decision, expectedRevision: 1 }])).status).toBe(400)
  expect(await records()).toMatchObject([
    {
      itemId: decision.decisionId,
      answer: {
        state: 'chosen',
        optionId: 'keep',
        reply: 'The code shows it.',
      },
    },
  ])
})

it('records and clears a claim disposition independently of an answer', async () => {
  const claimId = '#203/serious'
  const put = (expectedRevision: number, disposition: routes.DispositionWrite['disposition']) =>
    request(routes.putStackDisposition, {
      params,
      body: { claimId, expectedRevision, disposition },
    })
  expect((await put(0, { state: 'assigned', person: 'Jordan' })).status).toBe(200)
  expect(
    (
      await request(routes.putStackAnswer, {
        params,
        body: { decisionId: claimId, expectedRevision: 0, answer: { state: 'leftOpen' } },
      })
    ).status,
  ).toBe(200)
  expect((await put(0, null)).status).toBe(409)
  expect((await put(1, null)).status).toBe(200)
  expect(await records()).toMatchObject([
    { kind: 'decision', answer: { state: 'leftOpen' }, disposition: null },
    { kind: 'serious_claim', answer: null, disposition: null, revision: 2 },
  ])
})

it('records the author’s choice over MCP and suppresses the fix after a moved base', async () => {
  agent = new Client({ name: 'test-author', version: '1.0.0' })
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl ?? '')))
  const pull_request = layerUrl(201)
  const read = () =>
    agent!.callTool({ name: 'get_stack_review', arguments: { pull_request, wait_seconds: 0 } })
  const record = (option_id: string, decision_id = decision.decisionId) =>
    agent!.callTool({
      name: 'record_stack_decision',
      arguments: {
        pull_request,
        decision_id,
        option_id,
        note: 'Keep coverage.',
      },
    })
  expect(JSON.stringify((await read()).content)).toContain('`change`: Make the change')
  const unknownDecision = await record('keep', 'unknown')
  expect(unknownDecision.isError).toBe(true)
  expect(JSON.stringify(unknownDecision.content)).toContain(
    'Find decision IDs under Needs your decision in get_stack_review.',
  )
  const unknownOption = await record('invalid')
  expect(unknownOption.isError).toBe(true)
  expect(JSON.stringify(unknownOption.content)).toContain('Choose one of: keep, change.')
  expect((await record('change')).isError).not.toBe(true)
  const answered = await record('keep')
  expect(answered.isError).toBe(true)
  expect(JSON.stringify(answered.content)).toContain('already answered. Reopen it in the app')
  expect(JSON.stringify((await read()).content)).toContain('decision:#201/default:change')
  moveFirst = true
  const moved = JSON.stringify((await read()).content)
  expect(moved).toContain('Recheck against the current layer revisions')
  expect(moved).not.toContain('decision:#201/default:change')
  const confirm = await request(routes.putStackAnswer, {
    params: { id: 'stack-2' },
    body: {
      decisionId: decision.decisionId,
      expectedRevision: 1,
      confirm: [{ pull: 201, head: '201aaaaaaaa', base: 'moved' }],
      answer: {
        state: 'chosen',
        optionId: 'change',
        note: 'Keep coverage.',
      },
    },
  })
  expect(confirm.status).toBe(200)
  expect(JSON.stringify((await read()).content)).toContain('decision:#201/default:change')
})

it('carries an exact answer from an older session and can reopen it in the newer session alone', async () => {
  expect(
    (await request(routes.putStackAnswers, { params, body: { answers: [decision] } })).status,
  ).toBe(200)
  agent = new Client({ name: 'test-author', version: '1.0.0' })
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl ?? '')))
  const brief = () =>
    agent!.callTool({
      name: 'get_stack_review',
      arguments: { pull_request: layerUrl(201), wait_seconds: 0 },
    })
  expect(JSON.stringify((await brief()).content)).toContain(
    'Carried over from an earlier stack review.',
  )
  expect(
    (
      await request(routes.reopenStackAnswer, {
        params: { id: 'stack-2' },
        body: { decisionId: decision.decisionId, expectedRevision: 0 },
      })
    ).status,
  ).toBe(200)
  const reopened = JSON.stringify((await brief()).content)
  expect(reopened).toContain('Decision history')
  expect(reopened).not.toContain('Carried over from an earlier stack review.')
  expect(await records()).toMatchObject([{ revision: 1, answer: { optionId: 'keep' } }])
})
