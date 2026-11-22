import { expect, it, vi } from 'vitest'
import { stackBrief } from '../../../../shared/domain/stackBrief'
import { projectStackBrief } from '../../../../shared/domain/projectStackBrief'
import { stackDecisionRecord } from '../../../fixtures/stackDecisionRecord'
import type { StackRecord } from '../../../../shared/domain/stackReviewRecords'
import { LayerFixJobs } from '../../../../server/features/layer-fixes/layerFixJobs'
import { checkProblems, remoteMovement } from '../../../../server/features/layer-fixes/verification'
import {
  appliedLayerFixEntries,
  type LayerFixSession,
  type WorkerReport,
} from '../../../../shared/domain/layerFix'
import { modelPair } from '../../../../shared/domain/preferences'
import { Provider } from '../../../../shared/domain/types'
import { fixtureLayerFix } from '../../../fixtures/layerFix'
import {
  emptyResult,
  finishedStackReview,
  stackEntry,
  layerUrl,
} from '../../../fixtures/stackReview'
import type {
  EngineThreadOperations,
  EngineThreadStart,
} from '../../../../server/adapters/t3Engine/engineThreads'
import type {
  ThreadTurns,
  ThreadTurnRequest,
} from '../../../../server/adapters/t3Engine/threadTurns'

const commit = 'b'.repeat(40)
const report: WorkerReport = {
  summary: 'Fixed',
  fixes: [{ id: '#201/g1', status: 'applied', commits: [commit], note: 'Fixed' }],
  checks: [{ command: 'git rev-parse HEAD && pnpm test', exitCode: 0 }],
}

function harness(records: StackRecord[] = []) {
  const stack = finishedStackReview([
    stackEntry(201, 'g1'),
    stackEntry(201, 'g2', { destination: { pull: 201, field: 'title' } }),
  ])
  const saved = new Map<string, LayerFixSession>()
  const requests: string[] = []
  const turns: ThreadTurns = {
    run: async <T>(request: ThreadTurnRequest<T>) => {
      requests.push(request.message)
      const result = {
        outcome: { status: 'completed' as const, replies: [] },
        commands: [
          {
            id: 'cmd',
            input: 'git rev-parse HEAD && pnpm test',
            output: commit + '\nTests passed',
            exitCode: 0,
          },
        ],
        report: request.schema.parse(report),
      }
      await request.settled?.(result)
      return result
    },
  }
  const head = vi.fn(() => Promise.resolve(commit))
  const revision = vi.fn(() => Promise.resolve({ headSha: '201aaaaaaaa', baseSha: 'base-201' }))
  const check = vi.fn(() =>
    Promise.resolve([
      { entry: '#201/g1', status: 'applied' as const, note: 'The plan is applied.', evidence: [] },
    ]),
  )
  const prepare = vi.fn(() => Promise.resolve({ path: '/app/worktree', branch: 'fix-run' }))
  const jobs = new LayerFixJobs({
    store: {
      save: (session) => {
        saved.set(session.id, structuredClone(session))
      },
      get: (id) => saved.get(id),
      all: () => [...saved.values()].reverse(),
    },
    stack: () => stack,
    brief: () =>
      Promise.resolve(
        projectStackBrief(
          stackBrief(stack)!,
          stack.id,
          records,
          [...saved.values()].flatMap(appliedLayerFixEntries),
        ),
      ),
    models: () => modelPair(Provider.codex),
    turns,
    workspace: () =>
      Promise.resolve({
        location: 'slopbusters',
        project: { id: 'project', title: 'Example', workspaceRoot: '/app/clone' },
        threads: {
          startThread: (input: EngineThreadStart) =>
            Promise.resolve({
              threadId: input.threadId,
              messageId: input.messageId ?? '',
              runtimeMode: 'full-access',
            }),
        } as unknown as EngineThreadOperations,
        open: () => Promise.resolve(),
      }),
    prepare,
    instructions: (_path, seed) => Promise.resolve(seed),
    preventPush: vi.fn(() => Promise.resolve()),
    head,
    tip: () => Promise.resolve(commit),
    commits: () => Promise.resolve([commit]),
    revision,
    check,
  })
  return { jobs, stack, saved, requests, head, revision, check, prepare, turns }
}

async function settle(jobs: LayerFixJobs, id: string) {
  await vi.waitFor(() => {
    expect(jobs.get(id).status).not.toBe('running')
  })
  return jobs.get(id)
}

it('commits locally, checks the plans, and leaves metadata for the author', async () => {
  const h = harness()
  const session = await settle(h.jobs, (await h.jobs.start('stack-1', layerUrl(201))).id)
  expect(session.outcome).toBe('done')
  expect(session.commits).toEqual([commit])
  expect(session.left).toEqual([expect.stringContaining('left for the author')])
  expect(h.requests[0]).toContain('Fix g1.')
  expect(h.requests[0]).toContain('Never push')
  expect(h.prepare).toHaveBeenCalledWith('/app/clone', layerUrl(201), '201aaaaaaaa', session.id)
})

it('allows one correction round and then needs the author', async () => {
  const h = harness()
  h.check.mockResolvedValue([
    { entry: '#201/g1', status: 'partial' as 'applied', note: 'Missing a case.', evidence: [] },
  ])
  const session = await settle(h.jobs, (await h.jobs.start('stack-1', layerUrl(201))).id)
  expect(session.outcome).toBe('needs-you')
  expect(h.requests).toHaveLength(2)
  expect(h.requests[1]).toContain('Missing a case.')
  expect(session.correctionUsed).toBe(true)
})

it('refuses a layer moved since the brief and reserves the whole stack', async () => {
  const h = harness()
  h.stack.layers[0]!.headSha = 'new-head'
  await expect(h.jobs.start('stack-1', layerUrl(201))).rejects.toThrow('review it again')
  h.stack.layers[0]!.headSha = '201aaaaaaaa'
  const first = await h.jobs.start('stack-1', layerUrl(201))
  await expect(h.jobs.start('stack-1', layerUrl(201))).rejects.toThrow('already running')
  await settle(h.jobs, first.id)
})

it.each(['dirty', 'diverged'])(
  'recovers interrupted runs and refuses retry on a %s worktree',
  async (reason) => {
    const h = harness()
    const session = await settle(h.jobs, (await h.jobs.start('stack-1', layerUrl(201))).id)
    h.saved.set(session.id, { ...session, status: 'running', outcome: undefined })
    expect(h.jobs.get(session.id).outcome).toBe('interrupted')
    h.head.mockRejectedValueOnce(new Error(reason))
    await expect(h.jobs.retry(session.id)).rejects.toThrow(reason)
  },
)

it.each([
  ['b'.repeat(40), 'pushed'],
  ['c'.repeat(40), 'moved'],
] as const)('detects remote movement to %s as %s', (remote, outcome) => {
  expect(remoteMovement('a'.repeat(40), remote, commit)).toBe(outcome)
})

it('requires observed commands and lets observed failures override claimed success', () => {
  expect(checkProblems(report, []).join('\n')).toContain('not observed')
  expect(
    checkProblems(report, [
      {
        id: 'c',
        input: 'git rev-parse HEAD && pnpm test',
        output: commit + '\nTests passed',
        exitCode: 1,
        outputIndicatesFailure: true,
      },
    ]).join('\n'),
  ).toContain('observed failure')
  expect(
    checkProblems(report, [
      {
        id: 'c',
        input: 'git rev-parse HEAD && pnpm test',
        output: commit + '\nTests passed',
        exitCode: 0,
      },
    ]),
  ).toEqual([])
})

it('judges each check by its last run and ignores the worker’s other commands', () => {
  const run = (id: string, input: string, exitCode: number) => ({
    id,
    input,
    output: commit,
    exitCode,
  })
  expect(
    checkProblems(report, [
      run('search', 'grep -rn retry src', 1),
      run('before', 'git rev-parse HEAD && pnpm test', 1),
      run('after', 'git rev-parse HEAD && pnpm test', 0),
    ]),
  ).toEqual([])
  expect(
    checkProblems(report, [
      run('before', 'git rev-parse HEAD && pnpm test', 0),
      run('after', 'git rev-parse HEAD && pnpm test', 1),
    ]).join('\n'),
  ).toContain('observed failure')
})

it.each([
  ['b'.repeat(40), 'pushed'],
  ['c'.repeat(40), 'moved'],
] as const)('stops after a turn if GitHub reports %s (%s)', async (remote, outcome) => {
  const h = harness()
  h.revision.mockResolvedValueOnce({ headSha: '201aaaaaaaa', baseSha: 'base-201' })
  h.revision.mockResolvedValue({ headSha: remote, baseSha: 'base-201' })
  const session = await settle(h.jobs, (await h.jobs.start('stack-1', layerUrl(201))).id)
  expect(session.outcome).toBe(outcome)
  expect(h.requests).toHaveLength(1)
  expect(h.check).not.toHaveBeenCalled()
})

it('retries an interrupted run from its retained clean worktree and thread', async () => {
  const h = harness()
  const first = await settle(h.jobs, (await h.jobs.start('stack-1', layerUrl(201))).id)
  h.saved.set(first.id, { ...first, status: 'running', outcome: undefined })
  const retry = await h.jobs.retry(first.id)
  const result = await settle(h.jobs, retry.id)
  expect(result.worktree).toEqual(first.worktree)
  expect(result.thread).toEqual(first.thread)
  expect(h.prepare).toHaveBeenCalledTimes(1)
  expect(result.outcome).toBe('done')
})

it('admits an author-selected code change and freezes its answer revision on the worker item', async () => {
  const records: StackRecord[] = []
  const h = harness(records)
  h.stack.input!.entries.push(stackEntry(201, 'chosen', { disposition: 'ask' }))
  const brief = stackBrief(h.stack)!
  const decision = brief.decisions[0]!
  records.push(
    stackDecisionRecord(
      brief,
      decision,
      { state: 'chosen', optionId: 'change', note: 'Keep callers compatible.' },
      3,
    ),
  )
  const id = 'decision:#201/chosen:change'
  const session = await h.jobs.start(h.stack.id, layerUrl(201), [id])
  expect(session.fixes).toMatchObject([
    {
      id,
      plan: 'Fix chosen.',
      decision: {
        sessionId: h.stack.id,
        decisionId: decision.id,
        revision: 3,
        note: 'Keep callers compatible.',
      },
    },
  ])
  await settle(h.jobs, session.id)
})

it('never offers or admits applied entries and refuses a separate worktree for later answers', async () => {
  const records: StackRecord[] = []
  const h = harness(records)
  await settle(h.jobs, (await h.jobs.start(h.stack.id, layerUrl(201), ['#201/g1'])).id)
  h.stack.input!.entries.push(stackEntry(201, 'later', { disposition: 'ask' }))
  const brief = stackBrief(h.stack)!
  records.push(
    stackDecisionRecord(brief, brief.decisions[0]!, { state: 'chosen', optionId: 'change' }),
  )
  expect(
    h.jobs.latestForStack(h.stack.id, layerUrl(201), '201aaaaaaaa', 'base-201').availability
      .applied,
  ).toEqual(['#201/g1'])
  await expect(h.jobs.start(h.stack.id, layerUrl(201), ['#201/g1'])).rejects.toThrow(
    'already applied',
  )
  await expect(
    h.jobs.start(h.stack.id, layerUrl(201), ['decision:#201/later:change']),
  ).rejects.toThrow('previous run has a local worktree')
  expect(h.prepare).toHaveBeenCalledTimes(1)
})

it('refuses more fixes than the checker can cover before creating a worktree', async () => {
  const h = harness()
  h.stack.input!.entries.push(
    ...Array.from({ length: 41 }, (_, index) => stackEntry(201, `extra-${index}`)),
  )
  await expect(h.jobs.start(h.stack.id, layerUrl(201))).rejects.toThrow('Choose at most 40 fixes')
  expect(h.prepare).not.toHaveBeenCalled()
})

it('admits a different option after reopening and rejects the applied option when chosen again', async () => {
  const records: StackRecord[] = []
  const h = harness(records)
  h.stack.input!.entries.push(stackEntry(201, 'move'))
  h.stack.pass!.result = {
    ...emptyResult,
    ownership: [{ entry: '#201/move', layer: 202, reason: 'That layer owns the caller.' }],
  }
  h.stack.pass!.contested = ['ownership #201/move']
  const brief = stackBrief(h.stack)!
  const decision = brief.decisions[0]!
  const choose = (optionId: string | null, revision: number) => {
    records[0] = stackDecisionRecord(
      brief,
      decision,
      optionId ? { state: 'chosen', optionId } : null,
      revision,
    )
  }
  const first = 'decision:#201/move:layer-201'
  const other = 'decision:#201/move:layer-202'
  choose('layer-201', 1)
  h.saved.set(
    'fix-run',
    fixtureLayerFix({
      start: '201aaaaaaaa',
      fixes: [{ id: first, title: 'Move the guard', reason: 'Fix move.' }],
    }),
  )

  choose(null, 2)
  expect(projectStackBrief(brief, h.stack.id, records).decisions).toContain(decision)
  choose('layer-202', 3)
  h.revision.mockResolvedValue({ headSha: '202aaaaaaaa', baseSha: 'base-202' })
  const next = await h.jobs.start(h.stack.id, layerUrl(202), [other])
  expect(next.fixes.map(({ id }) => id)).toEqual([other])
  await settle(h.jobs, next.id)

  choose(null, 4)
  choose('layer-201', 5)
  expect(projectStackBrief(brief, h.stack.id, records, [first]).fixes[0]?.items[0]).toMatchObject({
    id: first,
    applied: true,
  })
  await expect(h.jobs.start(h.stack.id, layerUrl(201), [first])).rejects.toThrow('already applied')
})

it.each([{ commits: [] }, { commits: [commit] }])(
  'checks retained worktrees for commits before starting or retrying (%j)',
  async ({ commits }) => {
    const h = harness()
    const prior = fixtureLayerFix({
      start: '201aaaaaaaa',
      base: 'base-201',
      worktree: { path: '/app/prior', branch: 'prior' },
      fixes: [
        { id: '#201/g2', title: 'Edit the title', reason: 'Clarify intent.', field: 'title' },
      ],
      commits,
    })
    const stopped = fixtureLayerFix({
      id: 'stopped',
      start: prior.start,
      base: prior.base,
      status: 'cancelled',
      outcome: 'stopped',
      thread: undefined,
      commits: [],
    })
    h.saved.set(prior.id, prior)
    if (commits.length) {
      await expect(h.jobs.start(h.stack.id, layerUrl(201), ['#201/g1'])).rejects.toThrow(
        'previous run has a local worktree',
      )
      h.saved.set(stopped.id, stopped)
      await expect(h.jobs.retry(stopped.id)).rejects.toThrow('previous run has a local worktree')
    } else {
      h.saved.set(stopped.id, stopped)
      const retried = await h.jobs.retry(stopped.id)
      await settle(h.jobs, retried.id)
      h.saved.delete(retried.id)
      const started = await h.jobs.start(h.stack.id, layerUrl(201), ['#201/g1'])
      await settle(h.jobs, started.id)
    }
  },
)
