import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GandalfJobs } from '../server/features/gandalf/gandalfJobs'
import { ReviewerStore } from '../server/adapters/store'
import { Provider } from '../shared/domain/types'
import type { GandalfTurn } from '../shared/domain/gandalf'
import { UserError } from '../server/errors'
import { fixturePull } from './fixtures/pull'

const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const clean: GandalfTurn = { summary: 'No issues found.', approved: true, issues: [], edits: [] }
const fix = (content: string): GandalfTurn => ({
  summary: 'Fixed the resolution.',
  approved: false,
  issues: [],
  edits: [{ path: 'code.ts', content }],
})
let directory: string
let store: ReviewerStore
let jobs: GandalfJobs
let revision: string
const publish = vi.fn(() => Promise.resolve('resolved-sha'))
const close = vi.fn(() => Promise.resolve())
const resolve = vi.fn<NonNullable<ConstructorParameters<typeof GandalfJobs>[0]['resolve']>>()
const loadPull = vi.fn(() => Promise.resolve(fixturePull()))
const openWorkspace = vi.fn(() =>
  Promise.resolve({
    directory,
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

describe('Gandalf session lifecycle', () => {
  it('keeps completed updates and retries only the remaining PRs', async () => {
    const second = { ...fixturePull(), number: 200, url: fixturePull().url.replace(/\d+$/, '200') }
    loadPull
      .mockResolvedValueOnce(fixturePull())
      .mockRejectedValueOnce(new UserError('Unavailable'))
      .mockResolvedValue(second)
    const session = jobs.start('review-room/example', [fixturePull().url, second.url])
    expect((await completed(session.id, 'failed')).results).toHaveLength(1)
    jobs.retry(session.id)
    expect((await completed(session.id)).results).toHaveLength(2)
    expect(loadPull).toHaveBeenCalledTimes(3)
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
    expect(restarted.latest('review-room/example')).toMatchObject({
      status: 'cancelled',
      results: [{ published: true }],
    })
  })
})
