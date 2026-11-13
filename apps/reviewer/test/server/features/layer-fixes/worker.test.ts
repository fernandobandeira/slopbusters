import { expect, it, vi } from 'vitest'
import { LayerFixJobs } from '../../../../server/features/layer-fixes/layerFixJobs'
import { checkProblems, remoteMovement } from '../../../../server/features/layer-fixes/verification'
import type { LayerFixSession, WorkerReport } from '../../../../shared/domain/layerFix'
import { modelPair } from '../../../../shared/domain/preferences'
import { Provider } from '../../../../shared/domain/types'
import { finishedStackReview, stackEntry, layerUrl } from '../../../fixtures/stackReview'
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

function harness() {
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
  const session = await settle(h.jobs, h.jobs.start('stack-1', layerUrl(201)).id)
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
  const session = await settle(h.jobs, h.jobs.start('stack-1', layerUrl(201)).id)
  expect(session.outcome).toBe('needs-you')
  expect(h.requests).toHaveLength(2)
  expect(h.requests[1]).toContain('Missing a case.')
  expect(session.correctionUsed).toBe(true)
})

it('refuses a layer moved since the brief and reserves the whole stack', async () => {
  const h = harness()
  h.stack.layers[0]!.headSha = 'new-head'
  expect(() => h.jobs.start('stack-1', layerUrl(201))).toThrow('review it again')
  h.stack.layers[0]!.headSha = '201aaaaaaaa'
  const first = h.jobs.start('stack-1', layerUrl(201))
  expect(() => h.jobs.start('stack-1', layerUrl(201))).toThrow('already running')
  await settle(h.jobs, first.id)
})

it.each(['dirty', 'diverged'])(
  'recovers interrupted runs and refuses retry on a %s worktree',
  async (reason) => {
    const h = harness()
    const session = await settle(h.jobs, h.jobs.start('stack-1', layerUrl(201)).id)
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

it.each([
  ['b'.repeat(40), 'pushed'],
  ['c'.repeat(40), 'moved'],
] as const)('stops after a turn if GitHub reports %s (%s)', async (remote, outcome) => {
  const h = harness()
  h.revision.mockResolvedValueOnce({ headSha: '201aaaaaaaa', baseSha: 'base-201' })
  h.revision.mockResolvedValue({ headSha: remote, baseSha: 'base-201' })
  const session = await settle(h.jobs, h.jobs.start('stack-1', layerUrl(201)).id)
  expect(session.outcome).toBe(outcome)
  expect(h.requests).toHaveLength(1)
  expect(h.check).not.toHaveBeenCalled()
})

it('retries an interrupted run from its retained clean worktree and thread', async () => {
  const h = harness()
  const first = await settle(h.jobs, h.jobs.start('stack-1', layerUrl(201)).id)
  h.saved.set(first.id, { ...first, status: 'running', outcome: undefined })
  const retry = await h.jobs.retry(first.id)
  const result = await settle(h.jobs, retry.id)
  expect(result.worktree).toEqual(first.worktree)
  expect(result.thread).toEqual(first.thread)
  expect(h.prepare).toHaveBeenCalledTimes(1)
  expect(result.outcome).toBe('done')
})
