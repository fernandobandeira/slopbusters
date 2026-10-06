import { getAgentSession } from '../shared/api/agentSessions'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { loadBobSkill, reviewWithBob, reconcileWithBob } from '../server/features/bob/bobReview'
import { fetchPull } from '../server/features/pulls/github'
import { ReviewerStore } from '../server/adapters/store'
import * as routes from '../shared/api/bob'
import { Provider } from '../shared/domain/types'
import { fixtureBobAdvice, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'
import type { BobSession } from '../shared/domain/bob'

vi.mock('../server/features/bob/bobReview', () => ({
  loadBobSkill: vi.fn(),
  reviewWithBob: vi.fn(),
  reconcileWithBob: vi.fn(),
}))
vi.mock('../server/features/pulls/github', async (original) => ({
  ...(await original<typeof import('../server/features/pulls/github')>()),
  fetchPull: vi.fn(),
  createPullService: vi.fn(() => ({ fetchPull, fetchPullRevision: vi.fn() })),
}))
vi.mock('../server/adapters/reviewWorkspaces', () => ({
  ReviewWorkspaces: class {
    acquire() {
      return Promise.reject(new Error('No source in fixture'))
    }
    close() {
      return Promise.resolve()
    }
  },
}))
afterEach(() => {
  vi.resetAllMocks()
})
function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Bob API contracts and persistent tours', () => {
  it('validates selection, saves a completed session, and replays the review after restarting', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bob-api-'))
    let app = await startReviewerServer({
      dataDirectory: directory,
      staticDirectory: directory,
      port: 0,
    })
    let id = ''
    try {
      const selection = { repository: 'review-room/example', urls: [fixturePull().url] }
      expect((await post(`${app.url}/api/bob`, selection)).status).toBe(400)
      const store = new ReviewerStore({ dataDirectory: directory })
      store.savePreferences({ organization: { provider: Provider.codex, model: 'gpt-6.1-sol' } })
      store.close()
      expect(
        (
          await post(`${app.url}/api/bob`, {
            ...selection,
            urls: [fixturePull().url, fixturePull().url],
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await post(`${app.url}/api/bob`, {
            ...selection,
            urls: ['https://github.com/elsewhere/repo/pull/1'],
          })
        ).status,
      ).toBe(400)
      vi.mocked(loadBobSkill).mockResolvedValue('Bob skill')
      vi.mocked(fetchPull).mockResolvedValue(fixturePull())
      vi.mocked(reviewWithBob).mockImplementation(() => Promise.resolve(fixtureBobAdvice()))
      vi.mocked(reconcileWithBob).mockImplementation(() => Promise.resolve(fixtureBobAdvice()))
      const response = await post(`${app.url}/api/bob`, selection)
      expect(response.status).toBe(202)
      id = routes.startBob.response.parse(await response.json()).id
      await vi.waitFor(async () => {
        const saved = routes.getBob.response.parse(
          await (await fetch(`${app.url}/api/bob/${id}`)).json(),
        )
        expect(saved.status).toBe('complete')
      })
      await app.close()
      app = await startReviewerServer({
        dataDirectory: directory,
        staticDirectory: directory,
        port: 0,
      })

      const latest = routes.latestBob.response.parse(
        await (
          await fetch(
            `${app.url}/api/bob/latest?repository=review-room/example&url=${encodeURIComponent(fixturePull().url)}`,
          )
        ).json(),
      )
      await expectSavedTranscript(app.url, id)
      expect(latest.session?.id).toBe(id)
      expect(latest.session?.results[0]?.advice.findings).toEqual(fixtureBobAdvice().findings)
      saveFailedRetry(directory, required(latest.session))
      await expectSavedReviews(app.url, id)
      const missing = await fetch(
        `${app.url}/api/bob/latest?repository=review-room/example&url=https://github.com/review-room/example/pull/129`,
      )
      expect(routes.latestBob.response.parse(await missing.json()).session).toBeNull()
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

function saveFailedRetry(directory: string, completed: BobSession) {
  const store = new ReviewerStore({ dataDirectory: directory })
  try {
    store.saveBobSession({
      ...completed,
      id: 'later-failed',
      createdAt: '2099-01-01T00:00:00Z',
      status: 'failed',
      results: [],
      error: 'Provider unavailable',
    })
  } finally {
    store.close()
  }
}

async function expectSavedReviews(url: string, id: string) {
  const reviews = routes.savedBobReviews.response.parse(
    await (await fetch(`${url}/api/bob/reviews?repository=review-room/example`)).json(),
  )
  expect(reviews.reviews).toEqual([
    expect.objectContaining({
      sessionId: id,
      url: fixturePull().url,
      findingCount: 1,
      verdict: 'changes',
    }),
  ])
  const elsewhere = routes.savedBobReviews.response.parse(
    await (await fetch(`${url}/api/bob/reviews?repository=elsewhere/repo`)).json(),
  )
  expect(elsewhere.reviews).toEqual([])
}

async function expectSavedTranscript(url: string, id: string) {
  const transcript = getAgentSession.response.parse(
    await (await fetch(`${url}/api/agent-sessions/${id}`)).json(),
  )
  expect(transcript).toMatchObject({ kind: 'bob', status: 'complete' })
  expect(transcript.runs.map((run) => run.label)).toEqual([
    'Primary review',
    'Companion review',
    'Reconciliation',
  ])
  expect(transcript.runs.every((run) => run.status === 'complete')).toBe(true)
}
