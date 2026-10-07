import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GandalfJobs } from '../server/features/gandalf/gandalfJobs'
import { ReviewerStore } from '../server/adapters/store'
import { Provider, type PullRequest } from '../shared/domain/types'
import type { GandalfTask, GandalfTurn } from '../shared/domain/gandalf'
import { fixturePull } from './fixtures/pull'

type Options = ConstructorParameters<typeof GandalfJobs>[0]
const clean: GandalfTurn = {
  summary: 'No issues found.',
  approved: true,
  issues: [],
  edits: [],
  selections: [],
}
const failure = { name: 'build-and-test-server', summary: '', log: 'error TS2741' }
let directory: string
let store: ReviewerStore
let jobs: GandalfJobs | undefined
const resolve = vi.fn<NonNullable<Options['resolve']>>()
const publish = vi.fn(() => Promise.resolve('resolved-sha'))
const verify = vi.fn(() => Promise.resolve())
const loadFailures = vi.fn<NonNullable<Options['loadFailures']>>()
const openWorkspace = vi.fn<Options['openWorkspace']>()

beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'gandalf-ci-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({
    organization: { provider: Provider.codex, model: 'gpt-6.1-sol' },
    companion: { provider: Provider.claude, model: 'claude-opus-5-5' },
  })
  resolve.mockResolvedValue(clean)
  publish.mockResolvedValue('resolved-sha')
  verify.mockResolvedValue()
})
afterEach(async () => {
  await jobs?.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

function layers(count: number): PullRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fixturePull(),
    number: index + 1,
    url: fixturePull().url.replace(/\d+$/, String(index + 1)),
    headBranch: `layer-${String(index + 1)}`,
    baseBranch: index ? `layer-${String(index)}` : 'main',
  }))
}
/** Starts a CI session over a stack whose layers fail CI or are behind their base. */
async function fixCi(pulls: PullRequest[], state: { failing: number[]; behind: number[] }) {
  loadFailures.mockImplementation((pull) =>
    Promise.resolve(state.failing.includes(pull.number) ? [failure] : []),
  )
  openWorkspace.mockImplementation((pull: PullRequest, _signal: AbortSignal, _task: GandalfTask) =>
    Promise.resolve({
      directory,
      pull,
      needsUpdate: state.behind.includes(pull.number),
      conflicts: [],
      verify,
      inspect: () => Promise.resolve({ revision: 'tree', diff: '', conflicts: [] }),
      apply: () => Promise.resolve(),
      publish,
      close: () => Promise.resolve(),
    }),
  )
  const urls = pulls.map((pull) => pull.url)
  jobs = new GandalfJobs({
    store,
    resolve,
    loadFailures,
    openWorkspace,
    plan: () => Promise.resolve(urls),
    loadPull: (url) => {
      const pull = pulls.find((layer) => layer.url === url)
      return pull ? Promise.resolve(pull) : Promise.reject(new Error('Missing fixture PR'))
    },
  })
  const { id } = jobs.start('review-room/example', urls, 'ci')
  await vi.waitFor(() => {
    expect(jobs?.get(id).status).toBe('complete')
  })
  return jobs.get(id)
}

describe('Gandalf CI fixes', () => {
  it('gives the models the failing checks and pushes their agreed fix', async () => {
    const saved = await fixCi(layers(1), { failing: [1], behind: [] })
    expect(openWorkspace.mock.calls[0]?.[2]).toBe('ci')
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ task: 'ci', failures: [failure] })
    expect(saved.results[0]).toMatchObject({ published: true, resolvedSha: 'resolved-sha' })
    expect(saved.progress).toBe('You may pass. The fixes are pushed and CI is running again.')
  })
  it('leaves passing PRs alone even when they are behind their base', async () => {
    const saved = await fixCi(layers(1), { failing: [], behind: [1] })
    expect(resolve).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(saved.results[0]?.published).toBe(false)
  })
  it('merges a fixed stack layer into the passing layer above it', async () => {
    const saved = await fixCi(layers(2), { failing: [1], behind: [2] })
    expect(resolve.mock.calls.map(([request]) => request.pull.number)).toEqual([1, 1, 1, 2, 2, 2])
    expect(resolve.mock.calls[3]?.[0].failures).toEqual([])
    expect(saved.results.map((result) => result.published)).toEqual([true, true])
  })
  it('reports a fix that changed nothing, such as for a flaky check, without claiming a push', async () => {
    publish.mockResolvedValue(fixturePull().headSha)
    const saved = await fixCi(layers(1), { failing: [1], behind: [] })
    expect(saved.results[0]?.published).toBe(false)
    expect(saved.progress).toBe('You may pass. No failing check needed a change.')
  })
})
