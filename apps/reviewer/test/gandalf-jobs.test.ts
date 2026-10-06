import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GandalfJobs } from '../server/features/gandalf/gandalfJobs'
import { ReviewerStore } from '../server/adapters/store'
import { Provider, type PullRequest } from '../shared/domain/types'
import type { GandalfTurn } from '../shared/domain/gandalf'
import { UserError } from '../server/errors'
import { CommandTimeoutError } from '../server/adapters/process'
import { fixturePull } from './fixtures/pull'

const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const clean: GandalfTurn = {
  summary: 'No issues found.',
  approved: true,
  issues: [],
  edits: [],
  selections: [],
}
const fix = (content: string): GandalfTurn => ({
  summary: 'Fixed the resolution.',
  approved: false,
  issues: [],
  edits: [{ path: 'code.ts', content }],
  selections: [],
})
let directory: string
let store: ReviewerStore
let jobs: GandalfJobs
let revision: string
const publish = vi.fn(() => Promise.resolve('resolved-sha'))
const close = vi.fn(() => Promise.resolve())
const resolve = vi.fn<NonNullable<ConstructorParameters<typeof GandalfJobs>[0]['resolve']>>()
const loadPull = vi.fn<ConstructorParameters<typeof GandalfJobs>[0]['loadPull']>(() =>
  Promise.resolve(fixturePull()),
)
const verify = vi.fn(() => Promise.resolve())
const openWorkspace = vi.fn((pull: PullRequest) =>
  Promise.resolve({
    directory,
    pull,
    needsUpdate: true,
    verify,
    conflicts: ['code.ts'],
    inspect: () => Promise.resolve({ revision, diff: revision, conflicts: [] }),
    apply: (edits: GandalfTurn['edits']) => {
      if (edits.length) revision = edits[0]?.content ?? ''
      return Promise.resolve()
    },
    publish,
    close,
  }),
)
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'gandalf-jobs-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  revision = 'conflicted'
  resolve.mockResolvedValue(clean)
  publish.mockResolvedValue('resolved-sha')
  loadPull.mockResolvedValue(fixturePull())
  jobs = new GandalfJobs({ store, loadPull, openWorkspace, resolve })
})
afterEach(async () => {
  await jobs.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})
async function completed(id: string, status = 'complete') {
  await vi.waitFor(() => {
    expect(jobs.get(id).status).toBe(status)
  })
  return jobs.get(id)
}

describe('Gandalf round robin', () => {
  it('starts with the primary, applies secondary fixes and requires both approvals of the final revision', async () => {
    resolve
      .mockResolvedValueOnce(fix('primary-resolution'))
      .mockResolvedValueOnce(fix('secondary-fix'))
      .mockResolvedValueOnce(fix('primary-fix'))
      .mockResolvedValue(clean)
    const session = jobs.start('review-room/example', [fixturePull().url])
    const saved = await completed(session.id)
    expect(resolve.mock.calls.map(([turn]) => turn.role)).toEqual([
      'primary',
      'secondary',
      'primary',
      'secondary',
      'primary',
    ])
    expect(resolve.mock.calls.map(([turn]) => turn.model)).toEqual([
      primary,
      companion,
      primary,
      companion,
      primary,
    ])
    expect(saved.turns.filter((turn) => turn.approved).map((turn) => turn.revision)).toEqual([
      'primary-fix',
      'primary-fix',
    ])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(saved.results[0]).toMatchObject({
      resolvedSha: 'resolved-sha',
      rounds: 5,
      published: true,
    })
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('revokes earlier approval when the other model changes a previously approved resolution', async () => {
    resolve
      .mockResolvedValueOnce(fix('resolved'))
      .mockResolvedValueOnce(clean)
      .mockResolvedValueOnce(fix('new-fix'))
      .mockResolvedValue(clean)
    const session = jobs.start('review-room/example', [fixturePull().url])
    expect((await completed(session.id)).results[0]?.rounds).toBe(5)
  })
  it('never treats a clean primary resolution as its independent final review', async () => {
    const session = jobs.start('review-room/example', [fixturePull().url])
    expect((await completed(session.id)).results[0]?.rounds).toBe(3)
  })
  it('stops without publishing when the models do not agree', async () => {
    resolve.mockResolvedValue({ ...clean, approved: false, issues: ['Still unsure.'] })
    const session = jobs.start('review-room/example', [fixturePull().url])
    const saved = await completed(session.id, 'failed')
    expect(saved.error).toContain('20 turns')
    expect(resolve).toHaveBeenCalledTimes(20)
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('Gandalf stack resolution', () => {
  it('reviews and publishes clean automatic merges instead of skipping stack updates', async () => {
    const work = await openWorkspace(fixturePull())
    openWorkspace.mockResolvedValue({ ...work, conflicts: [] })
    const saved = await completed(jobs.start('review-room/example', [fixturePull().url]).id)
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(saved.results[0]).toMatchObject({ published: true, rounds: 3 })
    expect(verify).toHaveBeenCalledWith('resolved-sha')
  })
  it('revalidates previously skipped PRs on retry and replaces an obsolete conflict-free result', async () => {
    const work = await openWorkspace(fixturePull())
    openWorkspace.mockResolvedValueOnce({ ...work, needsUpdate: false })
    const session = jobs.start('review-room/example', [fixturePull().url])
    expect((await completed(session.id)).results[0]?.published).toBe(false)
    jobs.retry(session.id)
    const saved = await completed(session.id)
    expect(saved.results).toHaveLength(1)
    expect(saved.results[0]?.published).toBe(true)
    expect(publish).toHaveBeenCalledTimes(1)
  })
  it('replans a stack bottom-up and loads each child only after its parent is published', async () => {
    const pulls = [1, 2, 3].map((number) => ({
      ...fixturePull(),
      number,
      url: fixturePull().url.replace(/\d+$/, String(number)),
      headBranch: `layer-${number}`,
      baseBranch: number === 1 ? 'main' : `layer-${number - 1}`,
    }))
    const urls = pulls.map((pull) => pull.url)
    const plan = vi.fn(() => Promise.resolve(urls))
    let published = 0
    loadPull.mockImplementation(() => {
      const pull = pulls[published]
      if (!pull) throw new Error('Unexpected PR load')
      return Promise.resolve({ ...pull, baseSha: published ? `resolved-${published}` : 'main-tip' })
    })
    publish.mockImplementation(() => Promise.resolve(`resolved-${++published}`))
    jobs = new GandalfJobs({ store, loadPull, openWorkspace, resolve, plan })
    const session = jobs.start(
      'review-room/example',
      pulls
        .filter((pull) => pull.number !== 2)
        .reverse()
        .map((pull) => pull.url),
    )
    const saved = await completed(session.id)
    expect(saved.urls).toEqual(urls)
    expect(saved.results.map((result) => result.baseSha)).toEqual([
      'main-tip',
      'resolved-1',
      'resolved-2',
    ])
    expect(saved.results.map((result) => result.number)).toEqual([1, 2, 3])
    expect(loadPull.mock.calls.map(([url]) => url)).toEqual(urls)
  })
  it('keeps published updates but refuses completion if a branch changes during final verification', async () => {
    verify.mockRejectedValueOnce(new UserError('The base changed. Retry.'))
    const session = jobs.start('review-room/example', [fixturePull().url])
    const saved = await completed(session.id, 'failed')
    expect(saved.error).toContain('base changed')
    expect(saved.results[0]?.published).toBe(true)
  })
})

describe('Gandalf session lifecycle', () => {
  it('keeps completed updates and retries only the remaining PRs', async () => {
    const second = { ...fixturePull(), number: 200, url: fixturePull().url.replace(/\d+$/, '200') }
    loadPull
      .mockResolvedValueOnce(fixturePull())
      .mockRejectedValueOnce(new UserError('Unavailable'))
      .mockResolvedValueOnce({ ...fixturePull(), headSha: 'resolved-sha' })
      .mockResolvedValue(second)
    const session = jobs.start('review-room/example', [fixturePull().url, second.url])
    expect((await completed(session.id, 'failed')).results).toHaveLength(1)
    const previousWorkspace = await openWorkspace({ ...fixturePull(), headSha: 'resolved-sha' })
    openWorkspace.mockResolvedValueOnce({ ...previousWorkspace, needsUpdate: false })
    jobs.retry(session.id)
    expect((await completed(session.id)).results).toHaveLength(2)
    expect(loadPull).toHaveBeenCalledTimes(4)
    expect(publish).toHaveBeenCalledTimes(2)
  })
  it('cancels an active model and never publishes its late response', async () => {
    let finish: ((turn: GandalfTurn) => void) | undefined
    resolve.mockImplementation(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    const session = jobs.start('review-room/example', [fixturePull().url])
    await vi.waitFor(() => {
      expect(finish).toBeDefined()
    })
    jobs.cancel(session.id)
    finish?.(clean)
    await jobs.close()
    expect(jobs.get(session.id).status).toBe('cancelled')
    expect(publish).not.toHaveBeenCalled()
  })
  it('recovers interrupted sessions and preserves completed results across restarts', async () => {
    const session = jobs.start('review-room/example', [fixturePull().url])
    await completed(session.id)
    store.saveGandalfSession({
      ...jobs.get(session.id),
      status: 'running',
      id: 'interrupted',
      createdAt: '2999-01-01',
    })
    const restarted = new GandalfJobs({ store, loadPull, openWorkspace, resolve })
    loadPull.mockResolvedValue({ ...fixturePull(), headSha: 'resolved-sha' })
    const previousWorkspace = await openWorkspace({ ...fixturePull(), headSha: 'resolved-sha' })
    openWorkspace.mockResolvedValue({ ...previousWorkspace, needsUpdate: false })
    await restarted.resume()
    await vi.waitFor(() => {
      expect(restarted.get('interrupted').status).toBe('complete')
    })
    expect(restarted.latest('review-room/example')).toMatchObject({
      id: 'interrupted',
      status: 'complete',
      results: [{ published: true }],
    })
    expect(publish).toHaveBeenCalledTimes(1)
    await restarted.close()
  })
})

describe('Gandalf automatic recovery', () => {
  it('waits for an interrupted pass to stop before automatically resuming after wake', async () => {
    let interrupted = false
    resolve.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_done, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                interrupted = true
                reject(new Error('Interrupted during sleep'))
              }, 20)
            },
            { once: true },
          )
        }),
    )
    const session = jobs.start('review-room/example', [fixturePull().url])
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1)
    })
    const pausing = jobs.suspend()
    expect(jobs.get(session.id).status).toBe('running')
    expect(jobs.get(session.id).progress).toContain('paused')
    const waking = jobs.resume()
    expect(interrupted).toBe(false)
    await Promise.all([pausing, waking])
    const saved = await completed(session.id)
    expect(saved.error).toBeUndefined()
    expect(interrupted).toBe(true)
    expect(resolve).toHaveBeenCalledTimes(4)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('resumes unfinished work on app restart without a UI read', async () => {
    resolve.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_done, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('App stopped'))
            },
            { once: true },
          )
        }),
    )
    const session = jobs.start('review-room/example', [fixturePull().url])
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1)
    })
    await jobs.close()
    expect(store.getGandalfSession(session.id)?.status).toBe('running')
    store.close()
    store = new ReviewerStore({ dataDirectory: directory })
    jobs = new GandalfJobs({ store, loadPull, openWorkspace, resolve })
    await jobs.resume()
    expect((await completed(session.id)).id).toBe(session.id)
    expect(publish).toHaveBeenCalledTimes(1)
  })
})

describe('Gandalf recovery intent', () => {
  it('does not resume explicit cancellation, failure, or completed work', async () => {
    resolve.mockRejectedValueOnce(new UserError('The head changed. Retry.'))
    const failed = jobs.start('review-room/example', [fixturePull().url])
    await completed(failed.id, 'failed')
    const complete = jobs.start('review-room/other', [fixturePull().url])
    await completed(complete.id)
    await jobs.suspend()
    // This running record simulates work saved before sleep.
    store.saveGandalfSession({
      ...failed,
      id: 'cancelled',
      repository: 'review-room/cancelled',
      status: 'running',
    })
    jobs.cancel('cancelled')
    await jobs.resume()
    expect(store.pendingGandalfSessions()).toEqual([])
    expect(resolve).toHaveBeenCalledTimes(4)
    expect(jobs.get('cancelled').status).toBe('cancelled')
  })
  it('does not revive an older interrupted session superseded by a newer session', async () => {
    const session = jobs.start('review-room/example', [fixturePull().url])
    await completed(session.id)
    store.saveGandalfSession({
      ...session,
      id: 'older-interrupted',
      createdAt: '2000-01-01',
      status: 'running',
    })
    await jobs.resume()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(store.pendingGandalfSessions()).toEqual([])
  })
})

describe('Gandalf timeout recovery', () => {
  it('automatically retries a timeout once with a fresh checkout, then exposes the cause', async () => {
    resolve.mockRejectedValue(new CommandTimeoutError('codex'))
    const session = jobs.start('review-room/example', [fixturePull().url])
    const saved = await completed(session.id, 'failed')
    expect(saved.error).toContain('timed out again')
    expect(saved.timeoutRetries).toBe(1)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(openWorkspace).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
    resolve.mockResolvedValue(clean)
    jobs.retry(session.id)
    expect((await completed(session.id)).timeoutRetries).toBe(0)
  })
  it('finishes an automatically retried timeout under the same session', async () => {
    resolve.mockRejectedValueOnce(new CommandTimeoutError('codex'))
    const session = jobs.start('review-room/example', [fixturePull().url])
    const saved = await completed(session.id)
    expect(saved.timeoutRetries).toBe(1)
    expect(saved.error).toBeUndefined()
    expect(saved.failureContext).toBeUndefined()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(2)
  })
})
