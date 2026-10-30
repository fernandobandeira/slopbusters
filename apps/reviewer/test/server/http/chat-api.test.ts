import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../../../server/app'
import { ReviewerStore } from '../../../server/adapters/store'
import type { ChatHosts } from '../../../server/adapters/t3Engine/chatHosts'
import type { EngineThreadOperations } from '../../../server/adapters/t3Engine/engineThreads'
import * as routes from '../../../shared/api/chat'
import { Provider } from '../../../shared/domain/types'
import { fixtureBobAdvice } from '../../fixtures/bob'
import { fixturePull } from '../../fixtures/pull'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

const claude = { provider: Provider.claude, model: 'claude-opus-5-5' }

function t3CodeHosts() {
  const startThread = vi.fn().mockResolvedValue(undefined)
  const threads = {
    preparePullRequest: () =>
      Promise.resolve({ branch: 'feature', worktreePath: '/worktree', onPullRequestHead: true }),
    startThread,
  } as unknown as EngineThreadOperations
  const chatHosts: ChatHosts = {
    workspaceFor: () =>
      Promise.resolve({
        location: 't3code',
        threads,
        project: { id: 'project-1', title: 'project', workspaceRoot: '/code' },
        open: () => Promise.resolve(),
      }),
  }
  return { chatHosts, startThread }
}

async function serverWith(chatHosts: ChatHosts, organization?: Provider) {
  const directory = mkdtempSync(join(tmpdir(), 'chat-api-'))
  directories.push(directory)
  const store = new ReviewerStore({ dataDirectory: directory })
  const pull = fixturePull()
  store.bob.save({
    id: 'bob-1',
    repository: 'review-room/example',
    urls: [pull.url],
    primary: claude,
    companion: claude,
    status: 'complete',
    progress: 'Reviewed 1 PR.',
    results: [{ pull, fingerprint: 'f', advice: fixtureBobAdvice(), reviewers: [claude] }],
    createdAt: '2026-10-01T00:00:00Z',
  })
  if (organization) store.savePreferences({ organization: { ...claude, provider: organization } })
  store.close()
  return startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    chatHosts,
  })
}

function post(server: { url: string }, body: unknown) {
  return fetch(`${server.url}/api/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('continues a saved Uncle Bob review in T3 Code and returns where it runs', async () => {
  const { chatHosts, startThread } = t3CodeHosts()
  const server = await serverWith(chatHosts, Provider.claude)
  try {
    const response = await post(server, { persona: 'unclebob', sessionId: 'bob-1' })

    expect(response.status).toBe(200)
    const chat = routes.continueInT3Code.response.parse(await response.json())
    expect(chat).toMatchObject({ project: 'project', location: 't3code', onPullRequestHead: true })
    const start = startThread.mock.calls[0]?.[0] as { threadId: string; message: string }
    expect(start.threadId).toBe(chat.threadId)
    expect(start.message).toContain('## Uncle Bob: Improvements to make')
  } finally {
    await server.close()
  }
})

it('asks for a model first, reports a missing session, and needs a PR for Linus', async () => {
  const unconfigured = await serverWith(t3CodeHosts().chatHosts)
  const configured = await serverWith(t3CodeHosts().chatHosts, Provider.claude)
  try {
    const noModel = await post(unconfigured, { persona: 'unclebob', sessionId: 'bob-1' })
    const missing = await post(configured, { persona: 'unclebob', sessionId: 'gone' })
    const noUrl = await post(configured, { persona: 'linus', sessionId: 'linus-1' })

    expect(noModel.status).toBe(400)
    expect(await noModel.json()).toEqual({
      error: 'Choose your primary provider in Settings first.',
    })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'This Bob review is no longer available.' })
    expect(noUrl.status).toBe(400)
  } finally {
    await unconfigured.close()
    await configured.close()
  }
})
