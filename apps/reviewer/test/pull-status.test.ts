import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePullStatus, createPullStatusService } from '../server/features/pulls/pullStatus'
import { runCommand } from '../server/adapters/process'
import { startReviewerServer } from '../server/app'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { graphPull, graphRef } from './fixtures/pullStatus'

let statusService = createPullStatusService()
const fetchPullStatuses: ReturnType<typeof createPullStatusService>['fetchPullStatuses'] = (
  ...args
) => statusService.fetchPullStatuses(...args)
const fetchInboxStatuses: ReturnType<typeof createPullStatusService>['fetchInboxStatuses'] = (
  ...args
) => statusService.fetchInboxStatuses(...args)
vi.mock('../server/adapters/process', () => ({ runCommand: vi.fn() }))
const command = vi.mocked(runCommand)
beforeEach(() => {
  command.mockReset()
  statusService = createPullStatusService()
})

describe('GitHub merge readiness', () => {
  it('uses authoritative merge requirements even when every CI check is green', () => {
    const pull = { ...graphPull(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }
    const status = normalizePullStatus(pull)
    expect(status.checksState).toBe('SUCCESS')
    expect(status.readiness).toBe('not-ready')
    expect(status.reasons.join(' ')).toContain('Required reviews')
    expect(status.requiredApprovals).toBe(2)
    expect(status.checks[0]!).toMatchObject({
      name: 'build',
      required: true,
      conclusion: 'SUCCESS',
    })
  })
  it.each([
    [{ isDraft: true }, 'not-ready', 'draft'],
    [{ mergeable: 'CONFLICTING' }, 'not-ready', 'conflicts'],
    [{ reviewDecision: 'CHANGES_REQUESTED' }, 'not-ready', 'requested changes'],
    [{ mergeStateStatus: 'BEHIND' }, 'not-ready', 'updated'],
    [{ mergeStateStatus: 'UNKNOWN', mergeable: 'UNKNOWN' }, 'checking', 'calculating'],
    [{ mergeStateStatus: 'UNSTABLE' }, 'not-ready', 'Checks'],
    [{ state: 'MERGED' }, 'merged', 'merged'],
    [{ state: 'CLOSED' }, 'closed', 'closed'],
  ])('classifies %j conservatively', (changes, readiness, reason) => {
    const status = normalizePullStatus({ ...graphPull(), ...changes })
    expect(status.readiness).toBe(readiness)
    expect(status.reasons.join(' ')).toContain(reason)
  })
  it('only marks ready when GitHub reports CLEAN and MERGEABLE', () => {
    expect(normalizePullStatus(graphPull()).readiness).toBe('ready')
    expect(normalizePullStatus({ ...graphPull(), mergeStateStatus: 'HAS_HOOKS' }).readiness).toBe(
      'unknown',
    )
    const pending = graphPull()
    pending.commits.nodes[0]!.commit.statusCheckRollup.state = 'PENDING'
    expect(normalizePullStatus(pending).readiness).toBe('checking')
    pending.commits.nodes[0]!.commit.statusCheckRollup.state = 'FAILURE'
    expect(normalizePullStatus(pending).readiness).toBe('not-ready')
  })
  it('does not report ready when known required reviews have no confirmed review decision', () => {
    expect(normalizePullStatus({ ...graphPull(), reviewDecision: null })).toMatchObject({
      readiness: 'not-ready',
    })
  })
  it('uses the stack trunk review requirements rather than an unprotected intermediate branch', () => {
    const pull = {
      ...graphPull(),
      stack: { baseRefName: 'main' },
      baseRef: { name: 'feature-parent', branchProtectionRule: null },
    }
    expect(normalizePullStatus(pull, graphRef('main', 3)).requiredApprovals).toBe(3)
    expect(normalizePullStatus(pull).requiredApprovals).toBeNull()
  })
  it('combines enforcing rulesets with branch protection and ignores evaluation rules', () => {
    const pull = graphPull()
    const rule = (count: number, enforcement: string) => ({
      type: 'PULL_REQUEST',
      repositoryRuleset: { enforcement },
      parameters: {
        __typename: 'PullRequestParameters',
        requiredApprovingReviewCount: count,
        requireCodeOwnerReview: true,
      },
    })
    const value = {
      ...pull,
      baseRef: {
        ...pull.baseRef,
        rules: {
          nodes: [rule(3, 'ACTIVE'), rule(10, 'EVALUATE')],
          pageInfo: { hasNextPage: false },
        },
      },
    }
    expect(normalizePullStatus(value)).toMatchObject({
      requiredApprovals: 3,
      requiresCodeOwnerReviews: true,
      requirementsKnown: true,
    })
  })
  it('does not claim zero required reviews when GitHub says reviews are required but rules are unavailable', () => {
    const value = {
      ...graphPull(),
      reviewDecision: 'REVIEW_REQUIRED',
      baseRef: {
        name: 'main',
        branchProtectionRule: null,
        rules: { nodes: [], pageInfo: { hasNextPage: false } },
      },
    }
    expect(normalizePullStatus(value)).toMatchObject({
      requiredApprovals: null,
      requirementsKnown: false,
      readiness: 'not-ready',
    })
  })
  it('shows requested users and teams alongside latest submitted review states', () => {
    const pull = graphPull()
    const value = {
      ...pull,
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'alice',
              avatarUrl: 'https://avatars.githubusercontent.com/u/1',
            },
          },
          {
            requestedReviewer: {
              __typename: 'Team',
              slug: 'maintainers',
              organization: { login: 'example' },
            },
          },
        ],
        pageInfo: { hasNextPage: false },
      },
      latestReviews: {
        ...pull.latestReviews,
        nodes: [
          ...pull.latestReviews.nodes,
          { state: 'CHANGES_REQUESTED', author: { login: 'bob' } },
        ],
      },
    }
    expect(normalizePullStatus(value).reviewers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ login: 'alice', state: 'requested', type: 'user' }),
        expect.objectContaining({ login: 'bob', state: 'changes-requested' }),
        expect.objectContaining({ login: 'example/maintainers', state: 'requested', type: 'team' }),
      ]),
    )
  })
  it('counts only unresolved review discussions and preserves outdated thread previews', () => {
    const discussion = {
      id: 'thread1',
      isResolved: false,
      isOutdated: true,
      path: 'src/example.ts',
      line: null,
      originalLine: 10,
      comments: {
        nodes: [
          {
            body: 'a'.repeat(400),
            url: 'https://github.com/example/project/pull/1#discussion_r1',
            author: { login: 'alice' },
          },
        ],
      },
    }
    const status = normalizePullStatus({
      ...graphPull(),
      reviewThreads: {
        nodes: [discussion, { ...discussion, id: 'resolved', isResolved: true }],
        pageInfo: { hasNextPage: false },
      },
    })
    expect(status.unresolvedReviewThreads).toBe(1)
    expect(status.unresolvedThreads?.[0]!).toMatchObject({
      id: 'thread1',
      outdated: true,
      originalLine: 10,
      author: 'alice',
    })
    expect(status.unresolvedThreads?.[0]?.body).toHaveLength(300)
    const incomplete = normalizePullStatus({
      ...graphPull(),
      reviewThreads: { nodes: [discussion], pageInfo: { hasNextPage: true } },
    })
    expect(incomplete.unresolvedReviewThreads).toBeNull()
    expect(incomplete.warnings.join(' ')).toContain('unresolved total is unknown')
  })
  it('marks truncated details explicitly instead of presenting a complete ready state', () => {
    const pull = graphPull()
    pull.commits.nodes[0]!.commit.statusCheckRollup.contexts.pageInfo.hasNextPage = true
    const status = normalizePullStatus(pull)
    expect(status.warnings.join(' ')).toContain('100')
    expect(status.readiness).toBe('unknown')
  })
})

describe('batched GitHub status reads', () => {
  it('loads full metadata only for the authenticated author in My PRs, across paginated results', async () => {
    command.mockResolvedValueOnce(JSON.stringify({ login: 'Alice' }))
    command.mockResolvedValueOnce(
      JSON.stringify([
        [
          { number: 1, user: { login: 'alice' } },
          { number: 2, user: { login: 'bob' } },
        ],
        [{ number: 3, user: { login: 'ALICE' } }],
      ]),
    )
    command.mockResolvedValueOnce(
      JSON.stringify({
        data: {
          repository: {
            defaultBranchRef: graphRef(),
            pr1: graphPull(1),
            pr3: graphPull(3),
          },
        },
      }),
    )
    const result = await fetchInboxStatuses('example/project', true, 'mine')
    expect([...result.keys()]).toEqual([1, 3])
    expect(result.get(1)).toMatchObject({ detailLevel: 'full', unresolvedReviewThreads: 0 })
    expect(result.get(1)?.reviewers.length).toBeGreaterThan(0)
    expect(command).toHaveBeenCalledTimes(3)
    const query = JSON.parse(command.mock.calls[2]![0].input!).query
    expect(query).toContain('pr1:pullRequest(number:1)')
    expect(query).toContain('pr3:pullRequest(number:3)')
    expect(query).not.toContain('pr2:pullRequest(number:2)')
    expect(await fetchInboxStatuses('example/project', false, 'mine')).toBe(result)
    expect(command).toHaveBeenCalledTimes(3)
  })
  it('does not load other authors when authentication is missing, or any details when the owned subset is empty', async () => {
    command.mockResolvedValueOnce(JSON.stringify({}))
    command.mockResolvedValueOnce(JSON.stringify([[{ number: 2, user: { login: 'bob' } }]]))
    await expect(fetchInboxStatuses('example/project', false, 'mine')).rejects.toThrow()
    expect(command).toHaveBeenCalledTimes(2)
    command.mockResolvedValueOnce(JSON.stringify({ login: 'alice' }))
    command.mockResolvedValueOnce(JSON.stringify([[{ number: 2, user: { login: 'bob' } }]]))
    expect((await fetchInboxStatuses('example/project', false, 'mine')).size).toBe(0)
    expect(command).toHaveBeenCalledTimes(4)
  })
  it('fetches all stack layer statuses in one aliased GraphQL call', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify({
        data: {
          repository: {
            defaultBranchRef: graphRef(),
            pr1: graphPull(1),
            pr2: graphPull(2),
            pr3: graphPull(3),
          },
        },
      }),
    )
    const values = await fetchPullStatuses('example/project', [1, 2, 3])
    expect(values.size).toBe(3)
    expect(command).toHaveBeenCalledTimes(1)
    const query = JSON.parse(command.mock.calls[0]![0].input!).query
    expect(query).toContain('pr1:pullRequest(number:1)')
    expect(query).toContain('pr3:pullRequest(number:3)')
    expect(query).toContain('isRequired(pullRequestNumber:3)')
    expect([...values.values()].every((status) => status.readiness === 'ready')).toBe(true)
  })
  it('reads paginated inbox statuses in one CLI command instead of one process per row', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify([
        {
          data: {
            repository: {
              defaultBranchRef: graphRef(),
              pullRequests: {
                nodes: [graphPull(1)],
                pageInfo: { hasNextPage: true, endCursor: 'next' },
              },
            },
          },
        },
        {
          data: {
            repository: {
              defaultBranchRef: graphRef(),
              pullRequests: {
                nodes: [graphPull(2)],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      ]),
    )
    expect((await fetchInboxStatuses('example/project')).size).toBe(2)
    expect(command).toHaveBeenCalledTimes(1)
    const args = command.mock.calls[0]![0].args
    expect(args.slice(0, 4)).toEqual(['api', 'graphql', '--paginate', '--slurp'])
    expect(args).not.toContain('--input')
    const query = args.find((arg) => arg.startsWith('query='))!
    expect(query).not.toContain('reviewThreads(')
    expect(query).not.toContain('contexts(')
    expect(query).toContain('pageInfo {hasNextPage endCursor}')
  })
  it('coalesces concurrent repository rollups even for explicit refresh and briefly caches completed results', async () => {
    let resolveRead!: (value: string) => void
    command.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    const first = fetchInboxStatuses('example/project', true)
    const second = fetchInboxStatuses('example/project', true)
    await Promise.resolve()
    expect(command).toHaveBeenCalledTimes(1)
    resolveRead(
      JSON.stringify([
        {
          data: {
            repository: {
              pullRequests: { nodes: [graphPull(1)], pageInfo: { hasNextPage: false } },
            },
          },
        },
      ]),
    )
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(await fetchInboxStatuses('example/project')).toBe(a)
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('never treats a lightweight inbox rollup as a cached full review status', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify([
        {
          data: {
            repository: {
              pullRequests: { nodes: [graphPull(1)], pageInfo: { hasNextPage: false } },
            },
          },
        },
      ]),
    )
    const summaries = await fetchInboxStatuses('example/project')
    expect(summaries.get(1)?.detailLevel).toBe('summary')
    expect(summaries.get(1)?.checks).toEqual([])
    command.mockResolvedValueOnce(
      JSON.stringify({ data: { repository: { defaultBranchRef: graphRef(), pr1: graphPull(1) } } }),
    )
    const details = await fetchPullStatuses('example/project', [1])
    expect(details.get(1)?.detailLevel).toBe('full')
    expect(details.get(1)?.checks).toHaveLength(1)
    expect(command).toHaveBeenCalledTimes(2)
  })
  it('rejects partial GraphQL errors instead of classifying incomplete data as ready', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify({
        data: { repository: { pr1: graphPull() } },
        errors: [{ message: 'Check access denied' }],
      }),
    )
    await expect(fetchPullStatuses('example/project', [1])).rejects.toThrow('Check access denied')
  })
})

describe('asynchronous inbox status API', () => {
  it('validates repository names and returns background rollups without loading individual diffs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'review-inbox-status-'))
    const server = await startReviewerServer({
      dataDirectory: directory,
      staticDirectory: directory,
      port: 0,
    })
    try {
      expect((await fetch(`${server.url}/api/inbox-status?repository=invalid`)).status).toBe(400)
      expect(
        (await fetch(`${server.url}/api/inbox-status?repository=example%2Fproject&filter=unknown`))
          .status,
      ).toBe(400)
      expect(command).not.toHaveBeenCalled()
      command.mockResolvedValueOnce(
        JSON.stringify([
          {
            data: {
              repository: {
                pullRequests: { nodes: [graphPull(1)], pageInfo: { hasNextPage: false } },
              },
            },
          },
        ]),
      )
      const response = await fetch(`${server.url}/api/inbox-status?repository=example%2Fproject`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        statuses: [
          {
            number: 1,
            status: { headSha: 'head', detailLevel: 'summary', checksState: 'SUCCESS' },
          },
        ],
        warnings: [],
      })
      expect(command).toHaveBeenCalledTimes(1)
      command.mockRejectedValueOnce(new Error('GitHub temporarily unavailable'))
      const failed = await fetch(
        `${server.url}/api/inbox-status?repository=example%2Fproject&refresh=1`,
      )
      expect(failed.status).toBe(200)
      expect(await failed.json()).toMatchObject({
        statuses: [],
        warnings: [expect.stringContaining('unavailable')],
      })
    } finally {
      await server.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
