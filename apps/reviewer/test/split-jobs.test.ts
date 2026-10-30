import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayerBuildError, type SplitWorkspace } from '../server/adapters/splitWorkspace'
import { ReviewerStore } from '../server/adapters/store'
import { SplitJobs, stackBody } from '../server/features/split/splitJobs'
import type { SplitPulls } from '../server/features/split/splitPulls'
import type { cutWithLinus } from '../server/features/split/splitTurns'
import type { SplitLayerPlan, SplitTurn } from '../shared/domain/split'
import { Provider, type PullRequest } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const repository = 'review-room/example'
const units = [
  {
    id: 'u1',
    path: 'a.ts',
    kind: 'hunk' as const,
    header: '@@ -1 +1 @@',
    additions: 1,
    deletions: 1,
  },
  { id: 'u2', path: 'b.ts', kind: 'file' as const, header: 'added', additions: 3, deletions: 0 },
]
const cutA: SplitLayerPlan[] = [
  { title: 'Add b', description: 'The helper nothing calls yet.', units: ['u2'] },
  { title: 'Use b in a', description: 'The caller.', units: ['u1'] },
]
const cutB: SplitLayerPlan[] = [
  { title: 'Change a', description: 'First.', units: ['u1'] },
  { title: 'Add b', description: 'Second.', units: ['u2'] },
]
const approval: SplitTurn = { summary: 'The cut holds.', approved: true, issues: [], layers: [] }
let directory: string
let store: ReviewerStore
let jobs: SplitJobs
const build = vi.fn<SplitWorkspace['build']>()
const publish = vi.fn<SplitWorkspace['publish']>(() => Promise.resolve())
const close = vi.fn(() => Promise.resolve())
const create = vi.fn<SplitPulls['create']>()
const update = vi.fn<SplitPulls['update']>(() => Promise.resolve())
const cut = vi.fn<typeof cutWithLinus>()
const loadPull = vi.fn((url: string) => Promise.resolve({ ...fixturePull(), url }))
const openWorkspace = vi.fn((pull: PullRequest) =>
  Promise.resolve({
    directory,
    pull,
    baseSha: 'merge-base',
    units,
    patch: (id: string) => `patch of ${id}`,
    build,
    publish,
    close,
  }),
)

/** A model turn that proposes `layers`, building them through the job as the real turn does. */
function proposing(layers: SplitLayerPlan[], summary = 'Cut it.'): typeof cutWithLinus {
  return async (request) => {
    const problem = await request.tryCut(layers)
    return {
      summary: problem ?? summary,
      approved: false,
      issues: problem ? [problem] : [],
      layers,
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'split-jobs-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  build.mockImplementation((layers) =>
    Promise.resolve(
      layers.map((layer, index) => ({
        ...layer,
        units: [...layer.units],
        branch: `feature-${String(index + 1)}`,
        sha: `sha-${String(index + 1)}-${layer.title.toLowerCase().replace(/\W+/g, '-')}`,
        additions: 1,
        deletions: 0,
      })),
    ),
  )
  publish.mockResolvedValue(undefined)
  close.mockResolvedValue(undefined)
  update.mockResolvedValue(undefined)
  let number = 200
  create.mockImplementation(() => {
    number += 1
    return Promise.resolve({
      url: `https://github.com/${repository}/pull/${String(number)}`,
      number,
    })
  })
  loadPull.mockImplementation((url: string) => Promise.resolve({ ...fixturePull(), url }))
  cut.mockResolvedValue(approval)
  jobs = new SplitJobs({
    store,
    turns: recordingTurns().turns,
    skill: () => Promise.resolve('Linus split skill'),
    loadPull,
    openWorkspace,
    identity: () => Promise.resolve({ name: 'Author', email: 'author@example.com' }),
    pulls: { create, update },
    cut,
  })
})
afterEach(async () => {
  await jobs.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})
async function finished(id: string, status = 'complete') {
  await vi.waitFor(() => {
    expect(jobs.get(id).status).toBe(status)
  })
  return jobs.get(id)
}

describe('splitting a PR into a stack', () => {
  it('builds the primary’s cut, has the secondary approve it, then pushes and opens the PRs', async () => {
    cut.mockImplementationOnce(proposing(cutA)).mockResolvedValue(approval)
    const session = jobs.start(repository, fixturePull().url, {
      plan: [{ title: 'Add b', reason: 'Helper', dependsOn: [], verification: 'tests' }],
      linusSessionId: 'linus-1',
    })

    const done = await finished(session.id)

    expect(cut.mock.calls.map(([request]) => request.role)).toEqual([
      'primary',
      'secondary',
      'primary',
    ])
    expect(done.turns.map((turn) => [turn.role, turn.changed, turn.approved])).toEqual([
      ['primary', true, false],
      ['secondary', false, true],
      ['primary', false, true],
    ])
    expect(done.layers.map((layer) => [layer.branch, layer.pullNumber])).toEqual([
      ['feature-1', 201],
      ['feature-2', 202],
    ])
    expect(publish).toHaveBeenCalledWith(done.layers, [])
    expect(create).toHaveBeenNthCalledWith(
      1,
      { owner: fixturePull().owner, repo: fixturePull().repo },
      {
        title: 'Add b',
        body: 'The helper nothing calls yet.',
        head: 'feature-1',
        base: fixturePull().baseBranch,
        draft: true,
      },
      expect.any(AbortSignal),
    )
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ head: 'feature-2', base: 'feature-1' }),
      expect.any(AbortSignal),
    )
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      202,
      { body: expect.stringContaining('2. #202 Use b in a ← this PR') as string },
      expect.any(AbortSignal),
    )
    expect(done).toMatchObject({ verified: true, published: true, linusSessionId: 'linus-1' })
    expect(done.progress).toContain('Split PR #')
    expect(close).toHaveBeenCalledOnce()
    expect(store.split.get(session.id)?.status).toBe('complete')
  })
})

describe('a cut the models argue about', () => {
  it('starts over when the secondary re-cuts, until both approve the same cut', async () => {
    cut
      .mockImplementationOnce(proposing(cutA))
      .mockImplementationOnce(proposing(cutB, 'The caller must come first here.'))
      .mockResolvedValue(approval)
    const session = jobs.start(repository, fixturePull().url)

    const done = await finished(session.id)

    expect(done.turns.map((turn) => [turn.role, turn.changed, turn.approved])).toEqual([
      ['primary', true, false],
      ['secondary', true, false],
      ['primary', false, true],
      ['secondary', false, true],
    ])
    expect(done.layers.map((layer) => layer.title)).toEqual(['Change a', 'Add b'])
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('sends a cut that does not build back to the model instead of keeping it', async () => {
    build.mockRejectedValueOnce(
      new LayerBuildError(2, 'Layer 2 "Use b in a" does not apply to a.ts'),
    )
    cut
      .mockImplementationOnce(async (request) => {
        const problem = await request.tryCut(cutA)
        expect(problem).toContain('Layer 2 "Use b in a" does not apply')
        expect(await request.tryCut(cutB)).toBeUndefined()
        return { summary: 'Second try.', approved: false, issues: [], layers: cutB }
      })
      .mockResolvedValue(approval)
    const session = jobs.start(repository, fixturePull().url)

    const done = await finished(session.id)

    expect(done.layers.map((layer) => layer.title)).toEqual(['Change a', 'Add b'])
  })

  it('fails without publishing when the models never agree', async () => {
    let flip = false
    cut.mockImplementation((request) => {
      flip = !flip
      return proposing(flip ? cutA : cutB)(request)
    })
    const session = jobs.start(repository, fixturePull().url)

    const done = await finished(session.id, 'failed')

    expect(done.error).toContain('have not agreed on a cut after 8 turns')
    expect(publish).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('a split that cannot run', () => {
  it('refuses a closed PR, and reports a split a restart interrupted', async () => {
    loadPull.mockResolvedValueOnce({ ...fixturePull(), state: 'merged' })
    const session = jobs.start(repository, fixturePull().url)
    const done = await finished(session.id, 'failed')
    expect(done.error).toBe('Only an open PR can be split.')

    store.split.save({ ...done, id: 'interrupted', status: 'running' })
    expect(jobs.get('interrupted').status).toBe('cancelled')
  })

  it('writes the stack into every PR body', () => {
    const session = { ...jobs.start(repository, fixturePull().url), number: 7 }
    session.layers = [
      {
        title: 'Add b',
        description: 'Helper.',
        units: ['u2'],
        branch: 'f-1',
        sha: 's1',
        additions: 1,
        deletions: 0,
        pullNumber: 8,
        pullUrl: 'u',
      },
      {
        title: 'Use b',
        description: 'Caller.',
        units: ['u1'],
        branch: 'f-2',
        sha: 's2',
        additions: 1,
        deletions: 0,
      },
    ]
    const [first] = session.layers
    if (!first) throw new Error('Expected a layer.')
    expect(stackBody(session, first)).toBe(
      'Helper.\n\n---\n\nStack split from #7, bottom to top; each layer builds on the one below and the stack adds up to the original PR:\n\n1. #8 Add b ← this PR\n2. f-2 Use b',
    )
  })
})
