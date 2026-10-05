import { describe, expect, it, vi } from 'vitest'
import { createGitHub } from '../server/adapters/github'
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
