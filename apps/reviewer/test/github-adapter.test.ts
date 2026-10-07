import { describe, expect, it, vi } from 'vitest'
import { createGitHub } from '../server/adapters/github'
import { NetworkError } from '../server/adapters/network'
import { createPullStatusService } from '../server/features/pulls/pullStatus'
import { createStackService } from '../server/features/pulls/stacks'
import type { GitHub } from '../server/adapters/github'

function fakeGitHub(): GitHub {
  return { rest: vi.fn(), paginate: vi.fn(), graphql: vi.fn() }
}

describe('GitHub boundaries', () => {
  it('validates GraphQL errors on every page', async () => {
    const runner = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([{ data: {} }, { errors: [{ message: 'private diagnostic' }] }]),
      )
    const github = createGitHub(runner)
    await expect(github.graphql('query', { owner: 'example' }, true)).rejects.toThrow(
      'private diagnostic',
    )
  })

  it('paginates REST results once and preserves exact request bodies', async () => {
    const runner = vi.fn().mockResolvedValueOnce('[[1,2],[3]]').mockResolvedValueOnce('{"id":7}')
    const github = createGitHub(runner)
    expect(await github.paginate('repos/example/project/pulls')).toEqual([1, 2, 3])
    await github.rest('reviews', { method: 'POST', body: { text: 'a\n"quoted"' } })
    expect(runner).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: JSON.stringify({ text: 'a\n"quoted"' }) }),
    )
  })

  it('tests stack behavior with an adapter fake instead of process arguments', async () => {
    const github = fakeGitHub()
    vi.mocked(github.paginate).mockResolvedValue([])
    const stacks = createStackService(github, createPullStatusService(github))
    const first = stacks.listNativeStacks('example/project')
    const second = stacks.listNativeStacks('example/project')
    expect(await first).toEqual({ stacks: [], warnings: [] })
    expect(await second).toEqual({ stacks: [], warnings: [] })
    expect(github.paginate).toHaveBeenCalledOnce()

    const anotherServer = createStackService(github, createPullStatusService(github))
    await anotherServer.listNativeStacks('example/project')
    expect(github.paginate).toHaveBeenCalledTimes(2)
  })
})

describe('GitHub connection failures', () => {
  const dialTimeout = new Error(
    'Get "https://api.github.com/repos/example/project/pulls/1": dial tcp 140.82.113.6:443: i/o timeout',
  )
  const droppedResponse = new Error('Post "https://api.github.com/graphql": unexpected EOF')

  it('repeats a read after a dropped connection', async () => {
    const runner = vi.fn().mockRejectedValueOnce(dialTimeout).mockResolvedValueOnce('{"id":1}')
    const github = createGitHub(runner, [0, 0])
    expect(await github.rest('repos/example/project/pulls/1')).toEqual({ id: 1 })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('reports an unreachable GitHub with a safe message after the retries are spent', async () => {
    const runner = vi.fn().mockRejectedValue(dialTimeout)
    const github = createGitHub(runner, [0, 0])
    const failure = await github
      .rest('repos/example/project/pulls/1')
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NetworkError)
    expect(failure).toMatchObject({
      message: 'GitHub could not be reached. Check your internet connection and retry.',
      status: 503,
      cause: dialTimeout,
    })
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('repeats a write only when the connection never opened', async () => {
    const runner = vi
      .fn()
      .mockRejectedValueOnce(dialTimeout)
      .mockRejectedValueOnce(droppedResponse)
      .mockResolvedValue('{}')
    const github = createGitHub(runner, [0, 0])
    await expect(
      github.rest('repos/example/project/pulls/1/reviews', { method: 'POST', body: {} }),
    ).rejects.toThrow('Refresh to check whether it was saved')
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('repeats GraphQL reads but not GraphQL mutations after a dropped response', async () => {
    const runner = vi.fn().mockRejectedValueOnce(droppedResponse).mockResolvedValue('{"data":{}}')
    const github = createGitHub(runner, [0, 0])
    expect(await github.graphql('query { viewer { login } }', {})).toEqual({ data: {} })
    runner.mockRejectedValueOnce(droppedResponse)
    await expect(github.graphql('mutation { touch }', {})).rejects.toBeInstanceOf(NetworkError)
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('explains server outages and rate limits without repeating rate-limited requests', async () => {
    const outage = vi.fn().mockRejectedValue(new Error('gh: Bad Gateway (HTTP 502)'))
    await expect(createGitHub(outage, [0]).rest('user')).rejects.toThrow(
      'GitHub is not responding right now.',
    )
    expect(outage).toHaveBeenCalledTimes(2)
    const limited = vi.fn().mockRejectedValue(new Error('gh: API rate limit exceeded (HTTP 403)'))
    await expect(createGitHub(limited, [0]).rest('user')).rejects.toMatchObject({
      message: "GitHub's API rate limit was reached. Retry in a few minutes.",
      status: 429,
    })
    expect(limited).toHaveBeenCalledOnce()
  })

  it('passes other failures through unchanged and unrepeated', async () => {
    const missing = new Error('gh: Not Found (HTTP 404)')
    const runner = vi.fn().mockRejectedValue(missing)
    await expect(createGitHub(runner, [0]).rest('repos/example/missing')).rejects.toBe(missing)
    expect(runner).toHaveBeenCalledOnce()
  })
})
