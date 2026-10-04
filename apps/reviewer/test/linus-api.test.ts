import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/store'
import { fetchPull } from '../server/github'
import { loadLinusSkill, reconcileWithLinus, reviewWithLinus } from '../server/linusReview'
import { Provider } from '../shared/types'
import type { LinusAdvice, LinusSession } from '../shared/linus'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/github', async (original) => ({
  ...(await original<typeof import('../server/github')>()),
  fetchPull: vi.fn(),
}))
vi.mock('../server/linusReview', async (original) => ({
  ...(await original<typeof import('../server/linusReview')>()),
  loadLinusSkill: vi.fn(),
  reviewWithLinus: vi.fn(),
  reconcileWithLinus: vi.fn(),
}))
const directories: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const advice: LinusAdvice = {
  verdict: 'keep',
  reasoning: 'One logical change',
  revisedTitle: '',
  revisedDescription: '',
  layers: [],
  limitations: [],
  disagreements: [],
  steps: [{ text: 'Keep it together.', emotion: 'happy', target: 'overview', reference: '' }],
}
function request(url: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'linus-api-'))
  directories.push(path)
  return path
}

describe('Linus review API and persistence', () => {
  it('keeps the newest saved recommendation per PR across sessions and restarts', async () => {
    const path = directory()
    const first = fixturePull()
    const second = {
      ...first,
      number: first.number + 1,
      url: first.url.replace(/\d+$/, String(first.number + 1)),
    }
    const old: LinusSession = {
      id: 'old-review',
      repository: 'review-room/example',
      urls: [first.url, second.url],
      primary,
      companion,
      status: 'complete',
      progress: 'Done',
      createdAt: '2026-01-01T00:00:00Z',
      results: [first, second].map((pull) => ({
        pull,
        fingerprint: pull.id,
        advice,
        reviewers: [primary, companion],
      })),
    }
    const store = new ReviewerStore({ dataDirectory: path })
    store.saveLinusSession(old)
    store.saveLinusSession({
      ...old,
      id: 'new-review',
      createdAt: '2026-01-02T00:00:00Z',
      status: 'cancelled',
      results: [
        {
          ...old.results[0],
          pull: { ...first, headSha: 'new-head' },
          advice: { ...advice, verdict: 'stack' },
        },
      ],
    })
    store.saveLinusSession({
      ...old,
      id: 'unfinished-review',
      createdAt: '2026-01-03T00:00:00Z',
      results: [],
    })
    store.saveLinusSession({
      ...old,
      id: 'other-repository',
      repository: 'someone/else',
      createdAt: '2026-01-04T00:00:00Z',
    })
    store.close()
    const app = await startReviewerServer({ dataDirectory: path, staticDirectory: path, port: 0 })
    try {
      const response = await fetch(
        `${app.url}/api/linus/recommendations?repository=review-room/example`,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        recommendations: [
          {
            sessionId: 'new-review',
            createdAt: '2026-01-02T00:00:00Z',
            url: first.url,
            number: first.number,
            headSha: 'new-head',
            verdict: 'stack',
          },
          {
            sessionId: 'old-review',
            createdAt: old.createdAt,
            url: second.url,
            number: second.number,
            headSha: second.headSha,
            verdict: 'keep',
          },
        ],
      })
      const replay = await (await fetch(`${app.url}/api/linus/old-review`)).json()
      expect(replay.results).toEqual(old.results)
      expect(
        await (await fetch(`${app.url}/api/linus/recommendations?repository=no/reviews`)).json(),
      ).toEqual({ recommendations: [] })
      expect((await fetch(`${app.url}/api/linus/recommendations?repository=invalid`)).status).toBe(
        400,
      )
    } finally {
      await app.close()
    }
  })
  it('requires the existing primary setup, merges the companion preference, and rejects unrelated/duplicate selections', async () => {
    const path = directory()
    const app = await startReviewerServer({ dataDirectory: path, staticDirectory: path, port: 0 })
    const endpoint = `${app.url}/api/linus`
    const body = { repository: 'review-room/example', urls: [fixturePull().url] }
    try {
      expect((await request(endpoint, 'POST', body)).status).toBe(400)
      expect(reviewWithLinus).not.toHaveBeenCalled()
      await request(`${app.url}/api/preferences`, 'PUT', { organization: primary, theme: 'nord' })
      await request(`${app.url}/api/preferences`, 'PUT', { companion })
      expect(await (await fetch(`${app.url}/api/preferences`)).json()).toEqual({
        organization: primary,
        companion,
        theme: 'nord',
      })
      expect(
        (
          await request(`${app.url}/api/preferences`, 'PUT', {
            companion: { ...companion, model: '--option' },
          })
        ).status,
      ).toBe(400)
      expect(
        (await request(endpoint, 'POST', { ...body, urls: [fixturePull().url, fixturePull().url] }))
          .status,
      ).toBe(400)
      expect(
        (
          await request(endpoint, 'POST', {
            ...body,
            urls: ['https://github.com/other/repo/pull/1'],
          })
        ).status,
      ).toBe(400)
      expect(
        (await request(endpoint, 'POST', { ...body, urls: Array(21).fill(fixturePull().url) }))
          .status,
      ).toBe(400)
    } finally {
      await app.close()
    }
  })
  it('saves completed advice and immutable descriptions across a server restart', async () => {
    vi.mocked(loadLinusSkill).mockResolvedValue('Skill')
    vi.mocked(fetchPull).mockResolvedValue(fixturePull())
    vi.mocked(reviewWithLinus).mockResolvedValue(advice)
    vi.mocked(reconcileWithLinus).mockResolvedValue(advice)
    const path = directory()
    let app = await startReviewerServer({ dataDirectory: path, staticDirectory: path, port: 0 })
    let id = ''
    try {
      await request(`${app.url}/api/preferences`, 'PUT', { organization: primary, companion })
      const response = await request(`${app.url}/api/linus`, 'POST', {
        repository: 'review-room/example',
        urls: [fixturePull().url],
      })
      expect(response.status).toBe(202)
      id = (await response.json()).id
      await vi.waitFor(async () =>
        expect(await (await fetch(`${app.url}/api/linus/${id}`)).json()).toMatchObject({
          status: 'complete',
          results: [{ pull: { description: fixturePull().description }, advice }],
        }),
      )
    } finally {
      await app.close()
    }
    app = await startReviewerServer({ dataDirectory: path, staticDirectory: path, port: 0 })
    try {
      const latest = await (
        await fetch(`${app.url}/api/linus/latest?repository=review-room/example`)
      ).json()
      expect(latest.session.id).toBe(id)
      expect(latest.session.status).toBe('complete')
      expect(latest.session.results[0].reviewers).toEqual([primary, companion])
    } finally {
      await app.close()
    }
  })
  it('migrates existing version-two databases without losing drafts or preferences', () => {
    const path = directory()
    let store = new ReviewerStore({ dataDirectory: path })
    store.savePull(fixturePull())
    store.savePreferences({ organization: primary })
    store.close()
    const database = new DatabaseSync(join(path, 'reviewer.sqlite'))
    database.exec('DROP TABLE linus_sessions; PRAGMA user_version = 2;')
    database.close()
    store = new ReviewerStore({ dataDirectory: path })
    try {
      expect(store.getPreferences().organization).toEqual(primary)
      expect(store.getPull(fixturePull().id).description).toBe(fixturePull().description)
      expect(store.latestLinusSession('review-room/example')).toBeUndefined()
    } finally {
      store.close()
    }
  })
})
