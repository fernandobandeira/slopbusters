import { describe, expect, it, vi } from 'vitest'
import type { GitHub } from '../server/adapters/github'
import type { SourceRepository } from '../server/adapters/sourceRepository'
import { ReviewNotFoundError } from '../server/adapters/store'
import { createPullService } from '../server/features/pulls/github'
import { Provider, type PullRequest } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

function fixture() {
  const pull = { ...fixturePull(), mergeBaseSha: 'a'.repeat(40), groupingSource: Provider.codex }
  const metadata = {
    number: pull.number,
    html_url: pull.url,
    title: 'Updated PR title',
    body: 'Updated description',
    user: { login: pull.author },
    state: 'open',
    updated_at: '',
    base: { ref: pull.baseBranch, sha: pull.baseSha },
    head: { ref: pull.headBranch, sha: pull.headSha },
    labels: [],
    changed_files: 1,
  }
  const github: GitHub = {
    rest: vi.fn((path: string) =>
      Promise.resolve(path.includes('/compare/') ? pull.mergeBaseSha : metadata),
    ),
    paginate: vi.fn(() =>
      Promise.resolve([
        {
          filename: 'example.ts',
          status: 'added',
          additions: 1,
          deletions: 0,
          patch: '@@ -0,0 +1 @@\n+export const value = 1',
        },
      ]),
    ),
    graphql: vi.fn(),
  }
  const repository: SourceRepository = { tree: vi.fn(), file: vi.fn() }
  let saved: PullRequest | undefined
  const read = vi.fn((id: string) => {
    if (saved?.id !== id) throw new ReviewNotFoundError()
    return saved
  })
  const service = createPullService(github, undefined, repository, read)
  return {
    pull,
    metadata,
    github,
    repository,
    read,
    service,
    save: (value: PullRequest) => {
      saved = value
    },
  }
}

describe('saved PR diff reuse', () => {
  it('reopens an unchanged PR with one metadata request and keeps its groups and copy evidence', async () => {
    const { pull, github, repository, service, save } = fixture()
    // The production ID is derived from both commit SHAs.
    const first = await service.fetchPull(pull.url)
    save({
      ...first,
      files: pull.files,
      transfers: pull.transfers,
      groups: pull.groups,
      groupingSource: Provider.codex,
    })
    vi.mocked(github.rest).mockClear()
    vi.mocked(github.paginate).mockClear()

    const reopened = await service.fetchPull(pull.url)

    expect(github.rest).toHaveBeenCalledOnce()
    expect(github.paginate).not.toHaveBeenCalled()
    expect(repository.tree).not.toHaveBeenCalled()
    expect(reopened).toMatchObject({
      title: 'Updated PR title',
      description: 'Updated description',
      groups: pull.groups,
      transfers: pull.transfers,
      groupingSource: Provider.codex,
    })
  })

  it.each(['head', 'base'] as const)(
    'downloads a new diff when the %s commit changes',
    async (side) => {
      const { pull, service, save, metadata, github } = fixture()
      const first = await service.fetchPull(pull.url)
      save(first)
      metadata[side].sha = 'd'.repeat(40)
      vi.mocked(github.paginate).mockClear()

      const updated = await service.fetchPull(pull.url)

      expect(updated.id).not.toBe(first.id)
      expect(github.paginate).toHaveBeenCalledOnce()
      expect(updated.groupingSource).toBe('files')
    },
  )

  it('reads the latest saved groups on every reopen instead of keeping a stale memory copy', async () => {
    const { pull, service, save } = fixture()
    const first = await service.fetchPull(pull.url)
    save({ ...first, groups: pull.groups, groupingSource: Provider.codex })
    await service.fetchPull(pull.url)
    const groups = pull.groups.map((group) => ({ ...group, title: 'Regenerated group' }))
    save({ ...first, groups, groupingSource: Provider.claude })

    expect(await service.fetchPull(pull.url)).toMatchObject({
      groups,
      groupingSource: Provider.claude,
    })
  })

  it('joins simultaneous downloads of the same revision and retries failed loads', async () => {
    const { pull, service, github } = fixture()
    vi.mocked(github.paginate).mockRejectedValueOnce(new Error('GitHub unavailable'))
    await expect(service.fetchPull(pull.url)).rejects.toThrow('GitHub unavailable')
    vi.mocked(github.paginate).mockClear()

    const [first, second] = await Promise.all([
      service.fetchPull(pull.url),
      service.fetchPull(pull.url),
    ])

    expect(first).toEqual(second)
    expect(github.paginate).toHaveBeenCalledOnce()
  })

  it('rejects mixed revisions when commits change during a download', async () => {
    const { pull, service, github, metadata } = fixture()
    vi.mocked(github.rest).mockImplementation((path) =>
      Promise.resolve(
        path.includes('/compare/')
          ? pull.mergeBaseSha
          : { ...metadata, head: { ...metadata.head } },
      ),
    )
    vi.mocked(github.paginate).mockImplementation(() => {
      metadata.head.sha = 'e'.repeat(40)
      return Promise.resolve([])
    })
    metadata.changed_files = 0

    await expect(service.fetchPull(pull.url)).rejects.toThrow('changed while it was loading')
  })
})
