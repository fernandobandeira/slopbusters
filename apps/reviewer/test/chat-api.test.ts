import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import type { ChatHosts } from '../server/adapters/t3Engine/chatHosts'
import type { EngineThreadOperations } from '../server/adapters/t3Engine/engineThreads'
import * as routes from '../shared/api/chat'
import { Provider } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

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
  store.savePull(fixturePull())
  if (organization)
    store.savePreferences({ organization: { provider: organization, model: 'claude-opus-5-5' } })
  store.close()
  return startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    chatHosts,
  })
}

function post(server: { url: string }, path: string, body: unknown) {
  return fetch(`${server.url}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('starts a chat with Uncle Bob about a saved PR and returns where it runs', async () => {
  const pull = fixturePull()
  const { chatHosts, startThread } = t3CodeHosts()
  const server = await serverWith(chatHosts, Provider.claude)
  try {
    const response = await post(server, `/pulls/${pull.id}/chat`, { persona: 'unclebob' })

    expect(response.status).toBe(200)
    const chat = routes.startPullChat.response.parse(await response.json())
    expect(chat).toMatchObject({ project: 'project', location: 't3code', onPullRequestHead: true })
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: chat.threadId, projectId: 'project-1' }),
    )
  } finally {
    await server.close()
  }
})

it('asks for a model first and rejects a Gandalf chat without a task', async () => {
  const pull = fixturePull()
  const unconfigured = await serverWith(t3CodeHosts().chatHosts)
  try {
    const noModel = await post(unconfigured, `/pulls/${pull.id}/chat`, { persona: 'linus' })
    const noTask = await post(unconfigured, `/pulls/${pull.id}/chat`, { persona: 'gandalf' })

    expect(noModel.status).toBe(400)
    expect(await noModel.json()).toEqual({ error: 'Choose your primary model in Settings first.' })
    expect(noTask.status).toBe(400)
  } finally {
    await unconfigured.close()
  }
})
