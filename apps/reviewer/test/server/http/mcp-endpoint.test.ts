import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredTurns } from '../../../server/adapters/t3Engine/engineTurns'
import { ReviewerStore } from '../../../server/adapters/store'
import { TeammateStore } from '../../../server/adapters/teammateStore'
import { startReviewerServer } from '../../../server/app'
import { PanelJobs } from '../../../server/features/panel/panelJobs'
import { StackReviewJobs } from '../../../server/features/stack-review/stackReviewJobs'
import { fetchPull } from '../../../server/features/pulls/github'
import { getMcpEndpoint, getPull } from '../../../shared/api'
import { Provider } from '../../../shared/domain/types'
import { fixtureGroupingReply } from '../../fixtures/grouping'
import { reply } from '../../fixtures/panelJobs'
import { fixturePull } from '../../fixtures/pull'
import { installSkill, temporarySkillRoots } from '../../fixtures/skills'
import { finishedStackReview } from '../../fixtures/stackReview'
import { recordingTurns } from '../../fixtures/turns'

vi.mock('../../../server/features/pulls/github', async (original) => ({
  ...(await original<typeof import('../../../server/features/pulls/github')>()),
  fetchPull: vi.fn(),
  createPullService: vi.fn(() => ({ fetchPull, fetchPullRevision: vi.fn() })),
}))
vi.mock('../../../server/adapters/reviewWorkspaces', () => ({
  ReviewWorkspaces: class {
    removeAbandoned() {
      return Promise.resolve()
    }
    unused() {
      return Promise.resolve([])
    }
    acquire() {
      return Promise.reject(new Error('No source in fixture'))
    }
    close() {
      return Promise.resolve()
    }
  },
}))

type App = Awaited<ReturnType<typeof startReviewerServer>>
const pullRequest = fixturePull().url
let data: string
let roots: ReturnType<typeof temporarySkillRoots>
let app: App | undefined
const clients: Client[] = []

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'mcp-endpoint-'))
  roots = temporarySkillRoots()
  const store = new ReviewerStore({ dataDirectory: data })
  store.savePreferences({ organization: { provider: Provider.claude, model: 'claude-opus-5-5' } })
  store.close()
  vi.mocked(fetchPull).mockResolvedValue(fixturePull())
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  await app?.close()
  app = undefined
  rmSync(data, { recursive: true, force: true })
  rmSync(roots.home, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

const skill = (name: string) =>
  fileURLToPath(new URL(`../../../../../skills/${name}`, import.meta.url))

/** No stack and no review history, at once: these tests never reach GitHub. */
const offline = () => Promise.reject(new Error('offline'))
const offlineGitHub = { rest: offline, paginate: offline, graphql: offline }

/** The app with its MCP endpoint on a free port, on `mcp.port`, or with none. */
async function start(turns: StructuredTurns, mcp: { port: number } | 'none' = { port: 0 }) {
  app = await startReviewerServer({
    dataDirectory: data,
    staticDirectory: data,
    skillRoots: roots,
    bobSkillDirectory: skill('unclebob'),
    terminatorSkillDirectory: skill('terminator'),
    structuredTurns: turns,
    github: offlineGitHub,
    port: 0,
    ...(mcp === 'none' ? {} : { mcp }),
  })
  return app
}

/** An MCP client as Claude Code or Codex connects: streamable HTTP, no browser origin. */
async function connect(url: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

async function callTool(client: Client, name: string, input: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: input })
  const [first] = result.content as { type: string; text: string }[]
  return { text: first?.text ?? '', failed: result.isError === true }
}

/** A turn that runs until its panel is cancelled. */
const hanging: StructuredTurns = {
  run: ({ signal }) =>
    new Promise((_resolve, reject) => {
      signal.throwIfAborted()
      signal.addEventListener('abort', () => {
        reject(new Error('Cancelled'))
      })
    }),
}

describe('panel results over MCP', () => {
  it('returns a grounded review and saves the PR with its groups', async () => {
    const pull = fixturePull()
    const grouping = fixtureGroupingReply(pull)
    const { turns } = recordingTurns((request) =>
      request.purpose?.startsWith('Organize') ? grouping : reply(request),
    )
    const { mcpUrl, url } = await start(turns)
    const agent = await connect(mcpUrl ?? '')

    const tools = await agent.listTools()
    const started = await callTool(agent, 'start_panel_review', { pull_request: pullRequest })
    const review = await callTool(agent, 'get_panel_review', {
      pull_request: pullRequest,
      wait_seconds: 10,
    })

    expect(agent.getInstructions()).toContain('Slopbusters review panels')
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'list_reviewers',
      'start_panel_review',
      'get_panel_review',
      'retry_panel_review',
      'cancel_panel_review',
      'start_stack_review',
      'get_stack_review',
      'record_stack_decision',
      'retry_stack_review',
      'cancel_stack_review',
      'apply_layer_fixes',
      'get_layer_fixes',
    ])
    expect(started).toEqual({
      text: expect.stringContaining('The panel is reviewing PR #128') as string,
      failed: false,
    })
    expect(review.text).toContain('Panel review of review-room/example#128')
    expect(review.text).toContain('Plan: Reuse the audit helper.')
    await vi.waitFor(async () => {
      const saved = await fetch(`${url}/api/pulls/${pull.id}`)
      const snapshot = getPull.response.parse(await saved.json())
      expect(snapshot.groupingSource).toBe(Provider.claude)
      expect(snapshot.groups).toMatchObject(grouping.rest)
    })
  })
})

describe('the MCP endpoint for coding agents', () => {
  it('answers what the agent got wrong as a failed tool call it can read', async () => {
    const { mcpUrl } = await start(hanging)
    const agent = await connect(mcpUrl ?? '')

    const noPanel = await callTool(agent, 'cancel_panel_review', { pull_request: pullRequest })
    const notAPull = await callTool(agent, 'start_panel_review', {
      pull_request: 'https://github.com/review-room/example',
    })

    expect(noPanel).toEqual({ text: 'No panel has reviewed PR #128.', failed: true })
    expect(notAPull.failed).toBe(true)
    expect(notAPull.text).toContain('Enter a valid GitHub pull request URL.')
  })

  it('refuses a web page, and anything but MCP requests', async () => {
    const { mcpUrl = '' } = await start(hanging)
    const initialize = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }

    const fromPage = await fetch(mcpUrl, {
      ...initialize,
      headers: { ...initialize.headers, Origin: 'https://example.com' },
    })
    const reading = await fetch(mcpUrl)
    const appApi = await fetch(new URL('/api/preferences', mcpUrl))

    expect(fromPage.status).toBe(403)
    expect(reading.status).toBe(405)
    expect(appApi.status).toBe(404)
  })

  it('closes without waiting for an agent that is waiting on a panel', async () => {
    const server = await start(hanging)
    const agent = await connect(server.mcpUrl ?? '')
    await callTool(agent, 'start_panel_review', { pull_request: pullRequest })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    void callTool(agent, 'get_panel_review', {
      pull_request: pullRequest,
      wait_seconds: 600,
    }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))

    await expect(within(server.close(), 3000)).resolves.toBeUndefined()
    // The wait ended with the connection, instead of failing on a store that had closed.
    expect(errors.mock.calls.flat().join('\n')).not.toContain('Slopbusters could not do that')
  })
})

describe('choosing panel seats over MCP', () => {
  const seats = [{ id: 'unclebob', providers: [Provider.codex, Provider.claude] }, 'terminator']

  async function withTeammate() {
    installSkill(roots.codex, 'AveryReview')
    await new TeammateStore(data).save({
      id: 'avery',
      name: 'Avery',
      skill: 'AveryReview',
      maxFindings: 20,
      updatedAt: new Date().toISOString(),
    })
    const server = await start(hanging)
    return connect(server.mcpUrl ?? '')
  }

  it('passes explicit providers and bare ids to the panel job', async () => {
    const started = vi.spyOn(PanelJobs.prototype, 'start')
    const server = await start(hanging)
    const agent = await connect(server.mcpUrl ?? '')

    const result = await callTool(agent, 'start_panel_review', {
      pull_request: pullRequest,
      reviewers: seats,
    })

    expect(result.failed).toBe(false)
    expect(started).toHaveBeenCalledWith('review-room/example', [pullRequest], seats)
  })

  it('passes explicit providers and bare ids to the stack job', async () => {
    const started = vi.spyOn(StackReviewJobs.prototype, 'start').mockResolvedValue({
      ...finishedStackReview([]),
      status: 'running',
    })
    const server = await start(hanging)
    const agent = await connect(server.mcpUrl ?? '')

    const result = await callTool(agent, 'start_stack_review', {
      pull_request: pullRequest,
      reviewers: seats,
    })

    expect(result.failed).toBe(false)
    expect(started).toHaveBeenCalledWith(pullRequest, seats)
  })

  it('lists available providers for built-in reviewers and teammates', async () => {
    const agent = await withTeammate()

    const result = await callTool(agent, 'list_reviewers')

    expect(result.failed).toBe(false)
    expect(result.text).toContain('- `unclebob`: Uncle Bob (codex, claude)')
    expect(result.text).toContain('- `terminator`: Terminator (codex, claude)')
    expect(result.text).toContain(
      "- `teammate:avery`: Avery (codex). Predicts this teammate's comments from the AveryReview skill.",
    )
    expect(result.text).toContain(
      'A bare id runs a built-in reviewer on the primary provider only and a teammate on every provider where its skill is installed.',
    )
  })

  it.each(['start_panel_review', 'start_stack_review'])(
    'rejects a teammate’s unsupported provider in %s',
    async (tool) => {
      const agent = await withTeammate()

      const result = await callTool(agent, tool, {
        pull_request: pullRequest,
        reviewers: [{ id: 'teammate:avery', providers: [Provider.claude] }],
      })

      expect(result.failed).toBe(true)
      expect(result.text).toContain("Avery's skill, AveryReview, is not installed for Claude.")
    },
  )
})

describe('where the MCP endpoint is', () => {
  const endpointOf = async (server: App) =>
    getMcpEndpoint.response.parse(await (await fetch(`${server.url}/api/mcp-endpoint`)).json())

  it('keeps the app running and says why when another program holds the port', async () => {
    const other = createServer()
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
    const { port } = other.address() as AddressInfo
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const server = await start(hanging, { port })
    const endpoint = await endpointOf(server)
    other.close()

    expect(server.mcpUrl).toBeUndefined()
    expect(endpoint).toEqual({
      problem: expect.stringContaining(`Another program is using port ${String(port)}`) as string,
    })
  })

  it('tells Settings where agents connect, and nothing when it serves none', async () => {
    const serving = await start(hanging)
    const served = await endpointOf(serving)
    await serving.close()
    const unserved = await endpointOf(await start(hanging, 'none'))

    expect(served).toEqual({ url: serving.mcpUrl })
    expect(serving.mcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(unserved).toEqual({})
  })
})

function within<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`Still waiting after ${String(milliseconds)} ms.`))
      }, milliseconds)
    }),
  ])
}
