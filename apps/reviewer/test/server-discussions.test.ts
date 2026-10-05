import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDiscussions, replyToThread } from '../server/features/pulls/discussions'
import { runCommand } from '../server/adapters/process'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/adapters/process', () => ({ runCommand: vi.fn() }))
const command = vi.mocked(runCommand)
const completePage: { hasNextPage: boolean; endCursor: string | null } = {
  hasNextPage: false,
  endCursor: null,
}
const nextPage = { hasNextPage: true, endCursor: 'next' }

function comment(id: string, author: { login: string } | null = { login: 'reviewer' }) {
  return {
    fullDatabaseId: id,
    author,
    body: `Feedback ${id}`,
    url: `https://github.com/example/project/pull/1#discussion_r${id}`,
    createdAt: '2026-10-01T12:00:00Z',
  }
}
function thread(id: string) {
  return {
    id,
    path: 'previously-changed.ts',
    line: null,
    originalLine: 42,
    diffSide: 'RIGHT',
    isResolved: true,
    isOutdated: true,
    viewerCanReply: true,
    comments: { nodes: [comment('4159399332')], pageInfo: completePage },
  }
}
function pullPage(
  threads: ReturnType<typeof thread>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = completePage,
  headSha = 'current-head',
) {
  return {
    data: {
      repository: {
        pullRequest: {
          headRefOid: headSha,
          baseRefOid: 'current-base',
          reviewThreads: { nodes: threads, pageInfo },
        },
      },
    },
  }
}
function respond(value: unknown) {
  command.mockResolvedValueOnce(JSON.stringify(value))
}
function inputAt(index: number): { query: string; variables: Record<string, unknown> } {
  const input = command.mock.calls[index]?.[0]!.input
  if (!input) throw new Error('Expected a GraphQL input')
  return JSON.parse(input)
}

beforeEach(() => command.mockReset())

describe('GitHub discussion loading', () => {
  it('loads every thread and reply, including resolved and outdated locations outside the diff', async () => {
    const root = thread('thread-0')
    root.comments = {
      nodes: Array.from({ length: 100 }, (_, index) => comment(String(index + 1))),
      pageInfo: nextPage,
    }
    respond(
      pullPage(
        [root, ...Array.from({ length: 99 }, (_, index) => thread(`thread-${index + 1}`))],
        nextPage,
      ),
    )
    respond({
      data: {
        node: {
          comments: {
            nodes: [comment('9223372036854775807', null)],
            pageInfo: completePage,
          },
        },
      },
    })
    respond(pullPage([thread('thread-100')]))

    const result = await fetchDiscussions(fixturePull())

    expect(result).toMatchObject({ headSha: 'current-head', baseSha: 'current-base' })
    expect(result.threads).toHaveLength(101)
    expect(result.threads[0]!).toMatchObject({
      path: 'previously-changed.ts',
      line: null,
      originalLine: 42,
      resolved: true,
      outdated: true,
    })
    expect(result.threads[0]?.comments).toHaveLength(101)
    expect(result.threads[0]?.comments.at(-1)).toMatchObject({
      id: '9223372036854775807',
      author: 'deleted user',
    })
    expect(inputAt(0).query).toContain('fullDatabaseId')
    expect(inputAt(1).variables).toEqual({ id: 'thread-0', cursor: 'next' })
    expect(inputAt(2).variables).toMatchObject({ cursor: 'next' })
    expect(command.mock.calls.every(([params]) => params.args[1]! === 'graphql')).toBe(true)
  })

  it('rejects mixed revision locations when the PR changes between thread pages', async () => {
    respond(pullPage([thread('old')], nextPage, 'old-head'))
    respond(pullPage([thread('new')], completePage, 'new-head'))
    await expect(fetchDiscussions(fixturePull())).rejects.toThrow('PR changed')
  })

  it('fails instead of looping or silently dropping threads for a repeated cursor', async () => {
    respond(pullPage([thread('first')], nextPage))
    respond(pullPage([thread('second')], nextPage))
    await expect(fetchDiscussions(fixturePull())).rejects.toThrow('incomplete discussion page')
    expect(command).toHaveBeenCalledTimes(2)
  })

  it('fails instead of dropping replies when a comment page lacks its continuation cursor', async () => {
    const root = thread('first')
    root.comments.pageInfo = { hasNextPage: true, endCursor: null }
    respond(pullPage([root]))
    await expect(fetchDiscussions(fixturePull())).rejects.toThrow('incomplete discussion page')
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('surfaces GraphQL errors rather than treating partial data as complete', async () => {
    respond({ ...pullPage([]), errors: [{ message: 'Review threads are unavailable.' }] })
    await expect(fetchDiscussions(fixturePull())).rejects.toThrow('Review threads are unavailable')
  })
})

describe('GitHub discussion replies', () => {
  it('uses the requested PR’s top-level comment ID and trims the reply', async () => {
    const pr = fixturePull()
    const root = thread('requested-thread')
    root.comments.nodes.push(comment('4159399333'))
    respond(pullPage([root]))
    respond({ html_url: 'https://github.com/example/project/pull/1#discussion_r4159399334' })

    await replyToThread({ pr, threadId: root.id, body: '  Please revisit this.  ' })

    expect(command.mock.calls[1]?.[0]).toMatchObject({
      command: 'gh',
      args: [
        'api',
        `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/4159399332/replies`,
        '--method',
        'POST',
        '--input',
        '-',
      ],
      input: JSON.stringify({ body: 'Please revisit this.' }),
    })
  })

  it('refuses a thread from another PR before publishing', async () => {
    respond(pullPage([thread('belongs-to-requested-pr')]))
    await expect(
      replyToThread({ pr: fixturePull(), threadId: 'foreign-thread', body: 'Feedback' }),
    ).rejects.toThrow('cannot receive a reply')
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]?.[0].args[1]!).toBe('graphql')
  })

  it('refuses replies without permission before publishing', async () => {
    const root = { ...thread('locked-thread'), viewerCanReply: false }
    respond(pullPage([root]))
    await expect(
      replyToThread({ pr: fixturePull(), threadId: root.id, body: 'Feedback' }),
    ).rejects.toThrow('cannot receive a reply')
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('rejects whitespace before making a GitHub request', async () => {
    await expect(
      replyToThread({ pr: fixturePull(), threadId: 'thread', body: ' \n ' }),
    ).rejects.toThrow('cannot be empty')
    expect(command).not.toHaveBeenCalled()
  })
})
