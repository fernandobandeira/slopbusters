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
import { fixtureBobAdvice } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

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
      expect(latest.session?.id).toBe(id)
      expect(latest.session?.results[0]?.advice.findings).toEqual(fixtureBobAdvice().findings)
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
