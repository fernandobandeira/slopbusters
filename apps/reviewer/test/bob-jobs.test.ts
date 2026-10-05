import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BobJobs } from '../server/features/bob/bobJobs'
import { loadBobSkill, reviewWithBob, reconcileWithBob } from '../server/features/bob/bobReview'
import { ReviewerStore } from '../server/adapters/store'
import { UserError } from '../server/errors'
import type { BobAdvice } from '../shared/domain/bob'
import { Provider } from '../shared/domain/types'
import { fixtureBobAdvice, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/features/bob/bobReview', () => ({
  loadBobSkill: vi.fn(),
  reviewWithBob: vi.fn(),
  reconcileWithBob: vi.fn(),
}))
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const repository = 'review-room/example'
let directory: string
let store: ReviewerStore
let jobs: BobJobs
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'bob-jobs-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  jobs = new BobJobs({
    store,
    staticDirectory: directory,
    loadPull: vi.fn(() => Promise.resolve(fixturePull())),
  })
  vi.mocked(loadBobSkill).mockResolvedValue('Bob skill')
  vi.mocked(reviewWithBob).mockImplementation(() => Promise.resolve(fixtureBobAdvice()))
  vi.mocked(reconcileWithBob).mockImplementation(() => Promise.resolve(fixtureBobAdvice()))
})
afterEach(async () => {
  await jobs.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('Bob dual review lifecycle', () => {
  it('starts both reviewers together, waits for both, then reconciles with the primary', async () => {
    const finish: ((advice: BobAdvice) => void)[] = []
    vi.mocked(reviewWithBob).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve)
        }),
    )
    const session = jobs.start(repository, [fixturePull().url])
    expect(jobs.start(repository, [fixturePull().url]).id).toBe(session.id)
    await vi.waitFor(() => {
      expect(finish).toHaveLength(2)
    })
    expect(vi.mocked(reviewWithBob).mock.calls.map(([request]) => request.model)).toEqual([
      primary,
      companion,
    ])
    required(finish[0])(fixtureBobAdvice())
    await Promise.resolve()
    expect(reconcileWithBob).not.toHaveBeenCalled()

    required(finish[1])(fixtureBobAdvice())
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(required(vi.mocked(reconcileWithBob).mock.calls[0])[0].model).toEqual(primary)
    expect(required(vi.mocked(reconcileWithBob).mock.calls[0])[0].pending.reviews).toHaveLength(2)
    expect(required(jobs.get(session.id).results[0]).reviewers).toEqual([primary, companion])
  })
  it('lets the user choose a partial review and preserves source failure limitations', async () => {
    const openRepository = vi.fn(() => Promise.reject(new UserError('Source unavailable')))
    jobs = new BobJobs({
      store,
      staticDirectory: directory,
      openRepository,
      loadPull: vi.fn(() => Promise.resolve(fixturePull())),
    })
    vi.mocked(reviewWithBob).mockImplementation(({ model }) => {
      if (model.provider === Provider.claude)
        return Promise.reject(new UserError('Claude unavailable'))
      return Promise.resolve(fixtureBobAdvice())
    })
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    expect(reconcileWithBob).not.toHaveBeenCalled()

    jobs.continue(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(required(jobs.get(session.id).results[0]).reviewers).toEqual([primary])
    expect(required(jobs.get(session.id).results[0]).advice.limitations.join(' ')).toContain(
      'Source unavailable',
    )
  })
  it('aborts both reviewers and ignores late results', async () => {
    vi.mocked(reviewWithBob).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Cancelled'))
            },
            { once: true },
          )
        }),
    )
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(reviewWithBob).toHaveBeenCalledTimes(2)
    })
    jobs.cancel(session.id)
    await jobs.close()

    expect(jobs.get(session.id).status).toBe('cancelled')
    expect(jobs.get(session.id).results).toEqual([])
    expect(reconcileWithBob).not.toHaveBeenCalled()
  })
})

describe('Bob settings and saved reviews', () => {
  it('defaults to Codex when Claude is primary and requires different providers', () => {
    store.savePreferences({ organization: companion, companion: undefined })
    const session = jobs.start(repository, [fixturePull().url])
    expect(session.primary).toEqual(companion)
    expect(session.companion.provider).toBe(Provider.codex)
    jobs.cancel(session.id)

    store.savePreferences({ organization: primary, companion: primary })
    expect(() => jobs.start(repository, [fixturePull().url])).toThrow(/both Codex and Claude/)
  })
  it('recovers interrupted sessions and retains completed results after reopening storage', async () => {
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    const saved = jobs.get(session.id)
    store.saveBobSession({ ...saved, id: 'interrupted', status: 'running', results: [] })
    expect(jobs.get('interrupted').status).toBe('cancelled')
    const reopened = new ReviewerStore({ dataDirectory: directory })
    try {
      expect(reopened.getBobSession(session.id)).toEqual(saved)
      expect(reopened.latestBobSession(repository, fixturePull().url)?.id).toBe('interrupted')
    } finally {
      reopened.close()
    }
  })
})
