import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import type { EngineThreadOperations } from '../server/adapters/t3Engine/engineThreads'
import * as routes from '../shared/api/linus'
import { Provider } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function engineWithProject(repository: string) {
  const startThread = vi.fn().mockResolvedValue(undefined)
  const engine: EngineThreadOperations = {
    projects: () =>
      Promise.resolve([{ id: 'project-1', title: 'project', workspaceRoot: '/code', repository }]),
    preparePullRequest: () =>
      Promise.resolve({ branch: 'feature', worktreePath: '/worktree', onPullRequestHead: true }),
    startThread,
    reveal: () => Promise.resolve(),
  }
  return { engine, startThread }
}

async function serverWith(engine: EngineThreadOperations, organization?: Provider) {
  const directory = mkdtempSync(join(tmpdir(), 'linus-chat-api-'))
  directories.push(directory)
  const store = new ReviewerStore({ dataDirectory: directory })
  const pull = fixturePull()
  store.savePull(pull)
  if (organization)
    store.savePreferences({ organization: { provider: organization, model: 'claude-opus-5-5' } })
  store.close()
  const server = await startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    engine,
  })
  return { server, pull }
}

it('starts a Linus chat for a saved PR and returns the T3 Code thread', async () => {
  const pull = fixturePull()
  const { engine, startThread } = engineWithProject(
    `github.com/${pull.owner}/${pull.repo}`.toLowerCase(),
  )
  const { server } = await serverWith(engine, Provider.claude)
  try {
    const response = await fetch(`${server.url}/api/pulls/${pull.id}/linus-chat`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const chat = routes.startLinusChat.response.parse(await response.json())
    expect(chat).toMatchObject({ project: 'project', onPullRequestHead: true })
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: chat.threadId, projectId: 'project-1' }),
    )
  } finally {
    await server.close()
  }
})

it('explains what to set up when no model is chosen or T3 Code has no matching project', async () => {
  const pull = fixturePull()
  const unconfigured = await serverWith(engineWithProject('github.com/someone/else').engine)
  const unmatched = await serverWith(
    engineWithProject('github.com/someone/else').engine,
    Provider.claude,
  )
  try {
    const noModel = await fetch(`${unconfigured.server.url}/api/pulls/${pull.id}/linus-chat`, {
      method: 'POST',
    })
    const noProject = await fetch(`${unmatched.server.url}/api/pulls/${pull.id}/linus-chat`, {
      method: 'POST',
    })

    expect(noModel.status).toBe(400)
    expect(await noModel.json()).toEqual({ error: 'Choose your primary model in Settings first.' })
    expect(noProject.status).toBe(400)
    expect(((await noProject.json()) as { error: string }).error).toContain(
      'as a project in T3 Code',
    )
  } finally {
    await unconfigured.server.close()
    await unmatched.server.close()
  }
})
