import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinusJobs } from '../server/features/linus/linusJobs'
import { ReviewerStore } from '../server/adapters/store'
import { fetchPull } from '../server/features/pulls/github'
import {
  loadLinusSkill,
  reconcileWithLinus,
  reviewWithLinus,
} from '../server/features/linus/linusReview'
import { Provider } from '../shared/domain/types'
import type { LinusAdvice } from '../shared/domain/linus'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/features/pulls/github', () => ({ fetchPull: vi.fn() }))
vi.mock('../server/features/linus/linusReview', async (original) => ({
  ...(await original<typeof import('../server/features/linus/linusReview')>()),
  loadLinusSkill: vi.fn(),
  reviewWithLinus: vi.fn(),
  reconcileWithLinus: vi.fn(),
}))
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
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const repository = 'review-room/example'
let directory: string
let store: ReviewerStore
let jobs: LinusJobs
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'linus-jobs-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  jobs = new LinusJobs(store, directory)
  vi.mocked(fetchPull).mockResolvedValue(fixturePull())
  vi.mocked(loadLinusSkill).mockResolvedValue('Linus review-only skill')
  vi.mocked(reviewWithLinus).mockResolvedValue(advice)
  vi.mocked(reconcileWithLinus).mockResolvedValue(advice)
})
afterEach(async () => {
  await jobs.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('dual Linus review sessions', () => {
  it('starts both independent reviews before awaiting either, then reconciles with the primary', async () => {
    const finish: ((value: LinusAdvice) => void)[] = []
    vi.mocked(reviewWithLinus).mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    )
    const session = jobs.start(repository, [fixturePull().url])
    expect(jobs.start(repository, [fixturePull().url]).id).toBe(session.id)
    await vi.waitFor(() => {
      expect(finish).toHaveLength(2)
    })
    expect(reviewWithLinus).toHaveBeenNthCalledWith(
      1,
      fixturePull(),
      primary,
      'Linus review-only skill',
      expect.any(AbortSignal),
      false,
    )
    expect(reviewWithLinus).toHaveBeenNthCalledWith(
      2,
      fixturePull(),
      companion,
      'Linus review-only skill',
      expect.any(AbortSignal),
      true,
    )
    finish[0]!(advice)
    await Promise.resolve()
    expect(reconcileWithLinus).not.toHaveBeenCalled()
    finish[1]!(advice)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(reconcileWithLinus).toHaveBeenCalledWith(
      expect.objectContaining({
        reviews: [
          { model: primary, advice },
          { model: companion, advice },
        ],
      }),
      primary,
      'Linus review-only skill',
      expect.any(AbortSignal),
    )
    expect(jobs.get(session.id).results[0]!.reviewers).toEqual([primary, companion])
    expect(new LinusJobs(store, directory).latest(repository)?.results).toHaveLength(1)
  })
  it('shares local inspection with both reviewers and reconciliation, then releases it', async () => {
    const context = {
      directory,
      sha: fixturePull().headSha,
      url: 'http://127.0.0.1:1/mcp',
      token: 'fixture-token',
      close: vi.fn(async () => {}),
    }
    const prepare = vi.fn(async () => context)
    jobs = new LinusJobs(store, directory, undefined, prepare)
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(
      vi
        .mocked(reviewWithLinus)
        .mock.calls.every(
          (call) => call[5] && 'repository' in call[5] && call[5].repository === context,
        ),
    ).toBe(true)
    expect(vi.mocked(reconcileWithLinus).mock.calls[0]![4]!).toEqual({
      repository: context,
      observer: undefined,
    })
    await vi.waitFor(() => {
      expect(context.close).toHaveBeenCalledTimes(1)
    })
  })

  it('waits for an explicit single-model choice when a reviewer fails', async () => {
    vi.mocked(reviewWithLinus).mockImplementation(async (_pull, model) => {
      if (model.provider === Provider.claude) throw new Error('Companion unavailable')
      return advice
    })
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    expect(reconcileWithLinus).not.toHaveBeenCalled()
    jobs.continue(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(jobs.get(session.id).results[0]!.reviewers).toEqual([primary])
    expect(reviewWithLinus).toHaveBeenCalledTimes(2)
  })
  it('preserves completed PRs on failure and retries only remaining PRs with current settings', async () => {
    const second = {
      ...fixturePull(),
      number: 129,
      url: 'https://github.com/review-room/example/pull/129',
    }
    vi.mocked(fetchPull)
      .mockResolvedValueOnce(fixturePull())
      .mockRejectedValueOnce(new Error('Snapshot unavailable'))
      .mockResolvedValue(second)
    const session = jobs.start(repository, [fixturePull().url, second.url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('failed')
    })
    expect(jobs.get(session.id).results).toHaveLength(1)
    store.savePreferences({ organization: { ...primary, model: 'updated-primary' } })
    jobs.retry(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(fetchPull).toHaveBeenCalledTimes(3)
    expect(jobs.get(session.id).results).toHaveLength(2)
    expect(jobs.get(session.id).results[0]!.reviewers[0]!.model).toBe(primary.model)
    expect(jobs.get(session.id).results[1]!.reviewers[0]!.model).toBe('updated-primary')
  })
  it('cancels both reviewers and ignores late results', async () => {
    vi.mocked(reviewWithLinus).mockImplementation(
      (_pull, _model, _skill, signal) =>
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
      expect(reviewWithLinus).toHaveBeenCalledTimes(2)
    })
    jobs.cancel(session.id)
    await jobs.close()
    expect(jobs.get(session.id).status).toBe('cancelled')
    expect(jobs.get(session.id).results).toHaveLength(0)
    expect(reconcileWithLinus).not.toHaveBeenCalled()
  })
  it('recovers an interrupted saved session without claiming a review is still running', () => {
    store.saveLinusSession({
      id: 'interrupted',
      repository,
      urls: [fixturePull().url],
      primary,
      companion,
      status: 'running',
      progress: 'Reviewing',
      results: [],
      createdAt: new Date().toISOString(),
    })
    expect(jobs.latest(repository)?.status).toBe('cancelled')
    expect(store.getLinusSession('interrupted')?.status).toBe('cancelled')
  })
})
