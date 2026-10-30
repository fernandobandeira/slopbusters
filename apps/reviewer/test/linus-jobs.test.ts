import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinusJobs } from '../server/features/linus/linusJobs'
import { UserError } from '../server/errors'
import { ReviewerStore } from '../server/adapters/store'
import { fetchPull } from '../server/features/pulls/github'
import {
  loadLinusSkill,
  reconcileWithLinus,
  reviewWithLinus,
} from '../server/features/linus/linusReview'
import { Provider } from '../shared/domain/types'
import type { LinusAdvice } from '../shared/domain/linus'
import type { PanelSeatRequest } from '../shared/domain/panel'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

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
const anySignal: unknown = expect.any(AbortSignal)
let directory: string
let store: ReviewerStore
let jobs: LinusJobs
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'linus-jobs-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  jobs = new LinusJobs({ store, turns: recordingTurns().turns, staticDirectory: directory })
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
      expect.objectContaining({
        pull: fixturePull(),
        model: primary,
        skill: 'Linus review-only skill',
        signal: anySignal,
        companion: false,
      }),
    )
    expect(reviewWithLinus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pull: fixturePull(),
        model: companion,
        skill: 'Linus review-only skill',
        signal: anySignal,
        companion: true,
      }),
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
        pending: expect.objectContaining({
          reviews: [
            { model: primary, advice },
            { model: companion, advice },
          ],
        }) as unknown,
        model: primary,
        skill: 'Linus review-only skill',
        signal: anySignal,
      }),
    )
    expect(jobs.get(session.id).results[0]!.reviewers).toEqual([primary, companion])
    expect(
      new LinusJobs({ store, turns: recordingTurns().turns, staticDirectory: directory }).latest(
        repository,
      )?.results,
    ).toHaveLength(1)
  })
  it('shares local inspection with both reviewers and reconciliation, then releases it', async () => {
    const context = {
      directory,
      sha: fixturePull().headSha,
      release: vi.fn(),
    }
    const prepare = vi.fn(async () => context)
    jobs = new LinusJobs({
      store,
      turns: recordingTurns().turns,
      staticDirectory: directory,
      openRepository: prepare,
    })
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(reviewWithLinus).mock.calls.every(([request]) => request.repository === context),
    ).toBe(true)
    expect(vi.mocked(reconcileWithLinus).mock.calls[0]![0].repository).toBe(context)
    await vi.waitFor(() => {
      expect(context.release).toHaveBeenCalledTimes(1)
    })
  })

  it('waits for an explicit single-model choice when a reviewer fails', async () => {
    vi.mocked(reviewWithLinus).mockImplementation(async ({ model }) => {
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
  it('reopens a partial review for the same PR and names it when it blocks another', async () => {
    vi.mocked(reviewWithLinus).mockImplementation(({ model }) =>
      model.provider === Provider.claude
        ? Promise.reject(new Error('Companion unavailable'))
        : Promise.resolve(advice),
    )
    const session = jobs.start(repository, [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    const restarted = new LinusJobs({
      store,
      turns: recordingTurns().turns,
      staticDirectory: directory,
    })

    const reopened = restarted.start(repository, [fixturePull().url])

    expect(reopened).toMatchObject({ id: session.id, status: 'partial' })
    expect(restarted.latest(repository)?.id).toBe(session.id)
    const other = 'https://github.com/review-room/example/pull/129'
    expect(() => restarted.start(repository, [other])).toThrow(
      expect.objectContaining({
        status: 409,
        message: 'Finish or cancel the current Linus review of PR #128 before starting another.',
      }) as Error,
    )
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
    store.savePreferences({ organization: companion })
    jobs.retry(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(fetchPull).toHaveBeenCalledTimes(3)
    expect(jobs.get(session.id).results).toHaveLength(2)
    expect(jobs.get(session.id).results[0]!.reviewers[0]!.model).toBe(primary.model)
    expect(jobs.get(session.id).results[1]!.reviewers[0]!.model).toBe(companion.model)
  })
  it('cancels both reviewers and ignores late results', async () => {
    vi.mocked(reviewWithLinus).mockImplementation(
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
      expect(reviewWithLinus).toHaveBeenCalledTimes(2)
    })
    jobs.cancel(session.id)
    await jobs.close()
    expect(jobs.get(session.id).status).toBe('cancelled')
    expect(jobs.get(session.id).results).toHaveLength(0)
    expect(reconcileWithLinus).not.toHaveBeenCalled()
  })
  it('recovers an interrupted saved session without claiming a review is still running', () => {
    store.linus.save({
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
    expect(store.linus.get('interrupted')?.status).toBe('cancelled')
  })
})

const reviewers: PanelSeatRequest[] = [
  'unclebob',
  { id: 'terminator', providers: [Provider.claude] },
]
const split: LinusAdvice = {
  ...advice,
  verdict: 'stack',
  layers: [
    { title: 'Adapter', reason: 'Stands alone', dependsOn: [], verification: 'Unit tests' },
    { title: 'Feature', reason: 'Uses it', dependsOn: [1], verification: 'Integration' },
  ],
  steps: [{ text: 'Two changes.', emotion: 'angry', target: 'diff', reference: 'h1' }],
}
function withPanels() {
  const start = vi.fn((repository: string, urls: string[]) =>
    Promise.resolve({ id: `panel-${String(urls.length)}`, repository, urls } as never),
  )
  jobs = new LinusJobs({
    store,
    turns: recordingTurns().turns,
    staticDirectory: directory,
    panels: { start },
  })
  return start
}
async function completed(session: { id: string }) {
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  return jobs.get(session.id)
}

describe('the panel that follows Linus', () => {
  it('sends a PR Linus would keep straight on to the panel and records which one', async () => {
    const start = withPanels()
    const session = jobs.start(repository, [fixturePull().url], { thenPanel: { reviewers } })

    const done = await completed(session)

    expect(start).toHaveBeenCalledWith(repository, [fixturePull().url], reviewers)
    expect(done.results[0]).toMatchObject({ panelSessionId: 'panel-1' })
    expect(store.linus.recommendations(repository)[0]).toMatchObject({ panel: 'started' })
  })

  it('holds a PR Linus would split until the author sends it on anyway', async () => {
    const start = withPanels()
    vi.mocked(reconcileWithLinus).mockResolvedValue(split)
    const session = jobs.start(repository, [fixturePull().url], { thenPanel: { reviewers } })
    const done = await completed(session)
    expect(start).not.toHaveBeenCalled()
    expect(done.results[0]?.panelSessionId).toBeUndefined()
    expect(store.linus.recommendations(repository)[0]).toMatchObject({ panel: 'waiting' })

    const sent = await jobs.startPanel(session.id, fixturePull().url)

    expect(start).toHaveBeenCalledWith(repository, [fixturePull().url], reviewers)
    expect(sent.results[0]?.panelSessionId).toBe('panel-1')
    expect(store.linus.get(session.id)?.results[0]?.panelSessionId).toBe('panel-1')
    expect(store.linus.recommendations(repository)[0]).toMatchObject({ panel: 'started' })
  })

  it('keeps a panel that would not start as the result’s error, for the author to retry', async () => {
    const start = withPanels()
    start.mockRejectedValueOnce(
      new UserError('Finish or cancel the current panel review first.', 409),
    )
    const session = jobs.start(repository, [fixturePull().url], { thenPanel: { reviewers } })

    const done = await completed(session)

    expect(done.results[0]).toMatchObject({
      panelError: 'Finish or cancel the current panel review first.',
    })
    expect(store.linus.recommendations(repository)[0]).toMatchObject({ panel: 'waiting' })
    await expect(jobs.startPanel(session.id, fixturePull().url)).resolves.toMatchObject({
      results: [expect.objectContaining({ panelSessionId: 'panel-1' })],
    })
  })
})

describe('what the author tells Linus', () => {
  it('passes the author’s guidance to both reviewers and the reconciliation', async () => {
    const guidance = 'The adapter ships alone next week; keep it in this PR.'
    const session = jobs.start(repository, [fixturePull().url], { guidance })

    const done = await completed(session)

    expect(done.guidance).toBe(guidance)
    for (const [request] of vi.mocked(reviewWithLinus).mock.calls)
      expect(request.guidance).toBe(guidance)
    expect(vi.mocked(reconcileWithLinus).mock.calls[0]?.[0].guidance).toBe(guidance)
  })

  it('refuses to send a PR on without a panel to send it to', () => {
    expect(() =>
      jobs.start(repository, [fixturePull().url], { thenPanel: { reviewers: ['unclebob'] } }),
    ).toThrow('The review panel is not available here.')
    const plain = jobs.start(repository, [fixturePull().url])
    return expect(jobs.startPanel(plain.id, fixturePull().url)).rejects.toThrow(
      'Linus was not asked to send this PR on to the panel.',
    )
  })
})
