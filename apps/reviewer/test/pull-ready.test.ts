import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import type { GitHub } from '../server/adapters/github'
import { ReviewerStore } from '../server/adapters/store'
import { createPullService } from '../server/features/pulls/github'
import { markPullReady } from '../server/features/pulls/ready'
import { fixturePull } from './fixtures/pull'

const pull = { ...fixturePull(), isDraft: true }
const metadata = {
  node_id: 'PR_example',
  number: pull.number,
  html_url: pull.url,
  title: pull.title,
  body: pull.description,
  user: { login: pull.author },
  state: 'open',
  draft: true,
  updated_at: '',
  head: { ref: pull.headBranch, sha: pull.headSha },
  base: { ref: pull.baseBranch, sha: pull.baseSha },
  labels: [],
}
function fakeGitHub(): GitHub {
  return {
    rest: vi.fn().mockResolvedValue(metadata),
    paginate: vi.fn(),
    graphql: vi.fn().mockResolvedValue({
      data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
    }),
  }
}

describe('marking a draft pull request ready', () => {
  it('uses the current GitHub node ID without publishing a review', async () => {
    const github = fakeGitHub()
    await markPullReady(pull, github)
    expect(github.rest).toHaveBeenCalledExactlyOnceWith(
      `repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`,
    )
    expect(github.graphql).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('markPullRequestReadyForReview'),
      { pullRequestId: metadata.node_id },
    )
  })

  it('succeeds without another mutation when the PR is already ready', async () => {
    const github = fakeGitHub()
    vi.mocked(github.rest).mockResolvedValue({ ...metadata, draft: false })
    await markPullReady(pull, github)
    expect(github.graphql).not.toHaveBeenCalled()
  })

  it.each([
    [{ state: 'closed' }, 'no longer open'],
    [{ head: { sha: 'new-head' } }, 'New commits arrived'],
    [{ base: { sha: 'new-base' } }, 'New commits arrived'],
  ])('rejects changed or closed PRs before mutation: %j', async (changes, error) => {
    const github = fakeGitHub()
    vi.mocked(github.rest).mockResolvedValue({ ...metadata, ...changes })
    await expect(markPullReady(pull, github)).rejects.toThrow(error)
    expect(github.graphql).not.toHaveBeenCalled()
  })

  it('does not report success if GitHub leaves the pull request in draft', async () => {
    const github = fakeGitHub()
    vi.mocked(github.graphql).mockResolvedValue({
      data: { markPullRequestReadyForReview: { pullRequest: { isDraft: true } } },
    })
    await expect(markPullReady(pull, github)).rejects.toThrow()
  })

  it('refreshes draft metadata when reusing an immutable review snapshot', async () => {
    const github = fakeGitHub()
    const saved = { ...pull, mergeBaseSha: pull.baseSha }
    const service = createPullService(github, undefined, undefined, () => saved)
    expect((await service.fetchPull(pull.url)).isDraft).toBe(true)
    vi.mocked(github.rest).mockResolvedValue({ ...metadata, draft: false })
    expect((await service.fetchPull(pull.url)).isDraft).toBe(false)
    expect(github.paginate).not.toHaveBeenCalled()
  })
})

async function withServer(github: GitHub, test: (url: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'reviewer-ready-'))
  const store = new ReviewerStore({ dataDirectory: directory })
  store.savePull(pull)
  store.saveDraft(pull.id, { comments: [], summary: 'Keep my feedback', viewedFileIds: [] })
  store.close()
  const server = await startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    github,
  })
  try {
    await test(server.url)
  } finally {
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('ready API', () => {
  it('persists the ready state while retaining saved feedback', async () => {
    await withServer(fakeGitHub(), async (url) => {
      const response = await fetch(`${url}/api/pulls/${pull.id}/ready`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ...pull, isDraft: false })
      expect(await (await fetch(`${url}/api/pulls/${pull.id}`)).json()).toEqual({
        ...pull,
        isDraft: false,
      })
      expect(await (await fetch(`${url}/api/pulls/${pull.id}/draft`)).json()).toMatchObject({
        draft: { summary: 'Keep my feedback', comments: [] },
      })
    })
  })

  it('keeps the saved draft state when GitHub rejects the action', async () => {
    const github = fakeGitHub()
    vi.mocked(github.rest).mockResolvedValue({ ...metadata, state: 'closed' })
    await withServer(github, async (url) => {
      const response = await fetch(`${url}/api/pulls/${pull.id}/ready`, { method: 'POST' })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'This pull request is no longer open.' })
      expect(await (await fetch(`${url}/api/pulls/${pull.id}`)).json()).toEqual(pull)
    })
  })
})
