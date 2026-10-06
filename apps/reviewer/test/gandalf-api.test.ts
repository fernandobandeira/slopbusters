import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import { openConflictWorkspace } from '../server/adapters/conflictWorkspace'
import { resolveWithGandalf } from '../server/features/gandalf/gandalfResolution'
import { gandalfSessionSchema } from '../shared/domain/gandalf'
import { Provider } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/features/pulls/github', async (original) => ({
  ...(await original<typeof import('../server/features/pulls/github')>()),
  createPullService: vi.fn(() => ({
    fetchPull: () => Promise.resolve(fixturePull()),
    fetchPullRevision: vi.fn(),
  })),
}))
vi.mock('../server/adapters/conflictWorkspace', () => ({ openConflictWorkspace: vi.fn() }))
vi.mock('../server/features/gandalf/gandalfResolution', () => ({ resolveWithGandalf: vi.fn() }))
const directories: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'gandalf-api-'))
  directories.push(path)
  return path
}
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Gandalf API contracts and saved sessions', () => {
  it('rejects missing setup, unrelated or duplicate PRs and selections above the limit', async () => {
    const path = directory()
    const server = await startReviewerServer({
      dataDirectory: path,
      staticDirectory: path,
      port: 0,
    })
    try {
      const endpoint = `${server.url}/api/gandalf`
      const body = { repository: 'review-room/example', urls: [fixturePull().url] }
      expect((await post(endpoint, body)).status).toBe(400)
      await fetch(`${server.url}/api/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization: primary }),
      })
      for (const urls of [
        [fixturePull().url, fixturePull().url],
        ['https://github.com/other/repo/pull/1'],
        [],
        Array<string>(21).fill(fixturePull().url),
      ]) {
        expect((await post(endpoint, { ...body, urls })).status).toBe(400)
      }
      expect(openConflictWorkspace).not.toHaveBeenCalled()
      expect((await fetch(`${server.url}/api/gandalf/missing`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })
})

describe('Gandalf persistence across restarts', () => {
  it('persists the alternating review history and completed update across a server restart', async () => {
    const path = directory()
    const store = new ReviewerStore({ dataDirectory: path })
    store.savePreferences({ organization: primary })
    store.close()
    vi.mocked(openConflictWorkspace).mockResolvedValue({
      directory: path,
      conflicts: ['code.ts'],
      inspect: () => Promise.resolve({ revision: 'resolved', diff: '', conflicts: [] }),
      apply: () => Promise.resolve(),
      publish: () => Promise.resolve('resolved-sha'),
      close: () => Promise.resolve(),
    })
    vi.mocked(resolveWithGandalf).mockResolvedValue({
      summary: 'Approved.',
      approved: true,
      issues: [],
      edits: [],
    })
    const server = await startReviewerServer({
      dataDirectory: path,
      staticDirectory: path,
      port: 0,
    })
    let id = ''
    try {
      const response = await post(`${server.url}/api/gandalf`, {
        repository: 'review-room/example',
        urls: [fixturePull().url],
      })
      expect(response.status).toBe(202)
      id = gandalfSessionSchema.parse(await response.json()).id
      await vi.waitFor(async () => {
        expect(await (await fetch(`${server.url}/api/gandalf/${id}`)).json()).toMatchObject({
          status: 'complete',
          results: [{ resolvedSha: 'resolved-sha', rounds: 3 }],
        })
      })
    } finally {
      await server.close()
    }
    const restarted = await startReviewerServer({
      dataDirectory: path,
      staticDirectory: path,
      port: 0,
    })
    try {
      const saved: unknown = await (
        await fetch(`${restarted.url}/api/gandalf/latest?repository=review-room/example`)
      ).json()
      expect(saved).toMatchObject({
        session: {
          id,
          status: 'complete',
          turns: [
            { role: 'primary' },
            { role: 'secondary', approved: true },
            { role: 'primary', approved: true },
          ],
        },
      })
    } finally {
      await restarted.close()
    }
  })
})
