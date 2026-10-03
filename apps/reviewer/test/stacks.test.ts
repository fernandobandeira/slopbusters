import { beforeEach, describe, expect, it, vi } from 'vitest'
import { derivePullStack, type BranchPull } from '../shared/stacks'
import {
  branchPull,
  clearStackCache,
  getStackForPull,
  inboxStackSummaries,
  listNativeStacks,
  nativePullStack,
} from '../server/stacks'
import { runCommand } from '../server/process'
import { getInbox } from '../server/github'
import { clearPullStatusCache } from '../server/pullStatus'
import { graphPull, graphRef } from './fixtures/pullStatus'
import { startReviewerServer } from '../server/app'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../server/process', () => ({ runCommand: vi.fn() }))
const command = vi.mocked(runCommand)
const repository = 'example/project'
function pull(
  number: number,
  head: string,
  base: string,
  extra: Partial<BranchPull> = {},
): BranchPull {
  return {
    number,
    title: `Feature [${number}/3]`,
    url: `https://github.com/${repository}/pull/${number}`,
    repository,
    headBranch: head,
    baseBranch: base,
    state: 'open',
    isDraft: false,
    headRepositoryId: 'id:1',
    baseRepositoryId: 'id:1',
    ...extra,
  }
}
function rest(pull: BranchPull) {
  return {
    number: pull.number,
    html_url: pull.url,
    title: pull.title,
    state: pull.state === 'merged' ? ('closed' as const) : pull.state,
    merged_at: pull.state === 'merged' ? '2026-10-01T12:00:00Z' : null,
    draft: pull.isDraft,
    head: {
      ref: pull.headBranch,
      sha: 'head',
      repo: { id: Number(pull.headRepositoryId?.split(':')[1] ?? 1) },
    },
    base: {
      ref: pull.baseBranch,
      sha: 'base',
      repo: { id: Number(pull.baseRepositoryId?.split(':')[1] ?? 1) },
    },
    user: { login: 'alice' },
    body: '',
    updated_at: '2026-10-01T12:00:00Z',
    labels: [],
  }
}
function native() {
  return {
    id: 900,
    number: 42,
    base: { ref: 'main' },
    pull_requests: [
      rest(pull(1, 'foundation', 'main', { state: 'merged', title: 'Previous series [3/3]' })),
      rest(
        pull(2, 'contracts', 'foundation', {
          state: 'closed',
          title: 'Keep the closed prerequisite',
        }),
      ),
      rest(pull(3, 'ui', 'contracts', { isDraft: true, title: 'New series [1/2]' })),
    ],
  }
}
beforeEach(() => {
  command.mockReset()
  clearStackCache()
  clearPullStatusCache()
})

describe('repository-qualified branch dependency chains', () => {
  it('finds the whole ancestry across differently named series and sorts from base to top', () => {
    const result = derivePullStack(
      [pull(3, 'new-series', 'two'), pull(1, 'one', 'main'), pull(2, 'two', 'one')],
      2,
    )
    expect(result.stack).toMatchObject({
      source: 'derived',
      baseBranch: 'main',
      position: 2,
      size: 3,
    })
    expect(result.stack?.items.map((pull) => pull.number)).toEqual([1, 2, 3])
  })
  it('does not mistake a matching branch name in a fork for a prerequisite', () => {
    const unrelatedFork = pull(1, 'foundation', 'main', { headRepositoryId: 'id:2' })
    const child = pull(2, 'ui', 'foundation')
    expect(derivePullStack([unrelatedFork, child], 2).stack).toBeNull()
    const realParent = pull(3, 'foundation', 'main')
    expect(
      derivePullStack([unrelatedFork, child, realParent], 2).stack?.items.map(
        (pull) => pull.number,
      ),
    ).toEqual([3, 2])
  })
  it('requires known repository identities instead of trusting unqualified refs', () => {
    expect(
      derivePullStack(
        [pull(1, 'one', 'main', { headRepositoryId: null }), pull(2, 'two', 'one')],
        2,
      ).stack,
    ).toBeNull()
    const unknown = branchPull(
      {
        number: 1,
        state: 'open',
        head: { ref: 'one', repo: null },
        base: { ref: 'main', repo: null },
      },
      repository,
    )
    expect(unknown.headRepositoryId).toBeNull()
    expect(unknown.baseRepositoryId).toBeNull()
  })
  it('refuses ambiguous parent branch reuse and dependency cycles', () => {
    const ambiguous = derivePullStack(
      [pull(1, 'one', 'main'), pull(2, 'one', 'main'), pull(3, 'three', 'one')],
      3,
    )
    expect(ambiguous.stack).toBeNull()
    expect(ambiguous.warnings.join(' ')).toContain('ambiguous')
    const cycle = derivePullStack([pull(1, 'one', 'two'), pull(2, 'two', 'one')], 1)
    expect(cycle.stack).toBeNull()
    expect(cycle.warnings.join(' ')).toContain('cycle')
  })
  it('stops at sibling branch ambiguity rather than inventing a linear order', () => {
    const result = derivePullStack(
      [
        pull(1, 'one', 'main'),
        pull(2, 'two', 'one'),
        pull(3, 'three', 'two'),
        pull(4, 'four', 'two'),
      ],
      2,
    )
    expect(result.stack?.items.map((pull) => pull.number)).toEqual([1, 2])
    expect(result.warnings.join(' ')).toContain('multiple child')
    expect(
      derivePullStack(
        [
          pull(1, 'one', 'main'),
          pull(2, 'two', 'one'),
          pull(3, 'three', 'two'),
          pull(4, 'four', 'two'),
        ],
        3,
      ).stack?.items.map((pull) => pull.number),
    ).toEqual([1, 2, 3])
  })
})

describe('native GitHub stacks', () => {
  it('preserves authoritative order across closed/merged prerequisites and title series', () => {
    const result = nativePullStack(native(), repository, 3)
    expect(result.stack).toMatchObject({
      source: 'github',
      number: 42,
      position: 3,
      size: 3,
      baseBranch: 'main',
    })
    expect(result.stack?.items.map((pull) => [pull.number, pull.state, pull.isDraft])).toEqual([
      [1, 'merged', false],
      [2, 'closed', false],
      [3, 'open', true],
    ])
    const summaries = inboxStackSummaries(repository, [rest(pull(3, 'ui', 'main'))], [native()])
    expect(summaries.get(3)).toMatchObject({ source: 'github', position: 3, size: 3 })
  })
  it('reads native layers directly without downloading review diffs or querying each row', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify({ ...rest(pull(3, 'ui', 'contracts')), stack: { number: 42 } }),
    )
    command.mockResolvedValueOnce(JSON.stringify(native()))
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
    const result = await getStackForPull(`https://github.com/${repository}/pull/3`)
    expect(result.stack?.items.map((pull) => pull.number)).toEqual([1, 2, 3])
    expect(command.mock.calls.map(([options]) => options.args[1])).toEqual([
      `repos/${repository}/pulls/3`,
      `repos/${repository}/stacks/42`,
      'graphql',
    ])
  })
  it('never replaces unavailable known native membership with a misleading partial derived chain', async () => {
    command.mockResolvedValueOnce(
      JSON.stringify({
        ...rest(pull(3, 'ui', 'contracts')),
        stack: { number: 42, position: 3, size: 6, base: { ref: 'main' } },
      }),
    )
    command.mockRejectedValueOnce(new Error('Permission denied'))
    const result = await getStackForPull(`https://github.com/${repository}/pull/3`)
    expect(result.stack).toBeNull()
    expect(result.warnings.join(' ')).toContain('native stack')
    expect(result.summary).toMatchObject({
      source: 'github',
      number: 42,
      size: 6,
      position: 3,
      baseBranch: 'main',
    })
    expect(command).toHaveBeenCalledTimes(2)
  })
  it('coalesces bulk repository stack reads and caches unsupported capabilities gracefully', async () => {
    command.mockResolvedValue(JSON.stringify([[native()]]))
    const [first, second] = await Promise.all([
      listNativeStacks(repository, true),
      listNativeStacks(repository, true),
    ])
    expect(first).toEqual(second)
    expect(command).toHaveBeenCalledTimes(1)
    clearStackCache()
    command.mockReset().mockRejectedValue(new Error('Unsupported endpoint'))
    expect((await listNativeStacks(repository)).stacks).toEqual([])
    expect((await listNativeStacks(repository, true)).warnings).not.toEqual([])
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('keeps inbox rows readable when native stacks are unsupported and derives qualified chains', async () => {
    const values = [rest(pull(1, 'one', 'main')), rest(pull(2, 'two', 'one'))]
    command.mockImplementation(async (options) => {
      if (options.args[1] === 'user') return JSON.stringify({ login: 'alice' })
      if (options.args[1]?.includes('/stacks')) throw new Error('Unsupported endpoint')
      return JSON.stringify([values])
    })
    const inbox = await getInbox(repository)
    expect(inbox.pulls).toHaveLength(2)
    expect(inbox.pulls.map((pull) => pull.stack?.position)).toEqual([1, 2])
    expect(inbox.pulls.every((pull) => pull.stack?.source === 'derived')).toBe(true)
    expect(inbox.warnings?.join(' ')).toContain('unavailable')
    expect(command).toHaveBeenCalledTimes(3)
  })
  it('retains direct authoritative membership in inbox even if the bulk API failed', () => {
    const row = {
      ...rest(pull(3, 'ui', 'main')),
      stack: { number: 42, size: 6, position: 5, base: { ref: 'main' } },
    }
    expect(inboxStackSummaries(repository, [row], []).get(3)).toMatchObject({
      source: 'github',
      number: 42,
      size: 6,
      position: 5,
    })
  })
})

describe('stack read API', () => {
  it('validates GitHub URLs and serves native stack metadata without loading a review diff', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'review-stacks-api-'))
    const server = await startReviewerServer({
      dataDirectory: directory,
      staticDirectory: directory,
      port: 0,
    })
    try {
      expect((await fetch(`${server.url}/api/stack?url=https://other.example/pull/3`)).status).toBe(
        400,
      )
      expect(command).not.toHaveBeenCalled()
      command.mockResolvedValueOnce(
        JSON.stringify({ ...rest(pull(3, 'ui', 'contracts')), stack: { number: 42 } }),
      )
      command.mockResolvedValueOnce(JSON.stringify(native()))
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
      const response = await fetch(
        `${server.url}/api/stack?${new URLSearchParams({ url: `https://github.com/${repository}/pull/3` })}`,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        stack: { source: 'github', number: 42, position: 3, size: 3 },
        warnings: [],
      })
      expect(command).toHaveBeenCalledTimes(3)
    } finally {
      await server.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
