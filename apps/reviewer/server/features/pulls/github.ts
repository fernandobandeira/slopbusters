import { createHash } from 'node:crypto'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { z } from 'zod'
import { parseFile, detectTransfers, fileGroups } from '../diff'
import { buildGitHubReview } from '../../../shared/domain/review'
import {
  ReviewEvent,
  type PullRequest,
  type Repository,
  type RepositoryInbox,
  type ReviewDraft,
} from '../../../shared/domain/types'
import { createGitHub, type GitHub } from '../../adapters/github'
import { createMergeBaseLookup } from './mergeBase'
import { UserError } from '../../errors'
import type { PullRevision } from '../../../shared/domain/updates'
import { inboxStackSummaries, createStackService } from './stacks'

const userSchema = z.object({ login: z.string() })
const pullSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  user: userSchema,
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
  draft: z.boolean().optional(),
  updated_at: z.string(),
  changed_files: z.number().optional(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string() }),
  labels: z.array(z.object({ name: z.string() })),
  requested_reviewers: z.array(userSchema).optional(),
})
const fileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
})
const repoSchema = z.object({
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
})

export function createPullService(
  github: GitHub = createGitHub(),
  stacks = createStackService(github),
) {
  const ghJson = github.rest
  const ghPages = github.paginate
  const listNativeStacks = stacks.listNativeStacks
  const mergeBase = createMergeBaseLookup(github)
  /** Check the current revision without downloading patches or starting a provider. */
  async function fetchPullRevision(pr: PullRequest): Promise<PullRevision> {
    const metadata = z
      .object({
        state: z.enum(['open', 'closed']),
        merged: z.boolean().optional(),
        head: z.object({ sha: z.string() }),
        base: z.object({ sha: z.string() }),
      })
      .parse(await ghJson(`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`))
    return {
      headSha: metadata.head.sha,
      baseSha: metadata.base.sha,
      state: metadata.merged ? 'merged' : metadata.state,
    }
  }

  async function listRepositories(): Promise<{ viewer: string; repositories: Repository[] }> {
    const [user, pages] = await Promise.all([
      ghJson('user').then((value) => userSchema.parse(value)),
      ghPages(
        'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      ),
    ])
    return {
      viewer: user.login,
      repositories: z
        .array(repoSchema)
        .parse(pages)
        .map((repo) => ({
          fullName: repo.full_name,
          description: repo.description ?? '',
          private: repo.private,
        })),
    }
  }

  async function getInbox(repository: string): Promise<RepositoryInbox> {
    validateRepository(repository)
    const [user, values, native] = await Promise.all([
      ghJson('user').then((value) => userSchema.parse(value)),
      ghPages(`repos/${repository}/pulls?state=open&sort=updated&per_page=100`),
      listNativeStacks(repository, true),
    ])
    const pulls = z.array(pullSchema).parse(values)
    const summaries = inboxStackSummaries(repository, values, native.stacks)
    return {
      warnings: native.warnings,
      viewer: user.login,
      pulls: pulls.map((pr) => ({
        stack: summaries.get(pr.number),
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        author: pr.user.login,
        updatedAt: pr.updated_at,
        isDraft: pr.draft ?? false,
        headSha: pr.head.sha,
        labels: pr.labels.map((label) => label.name),
        reviewRequested:
          pr.requested_reviewers?.some((reviewer) => reviewer.login === user.login) ?? false,
      })),
    }
  }

  async function fetchPull(url: string): Promise<PullRequest> {
    const { owner, repo, number } = parsePullUrl(url)
    const endpoint = `repos/${owner}/${repo}/pulls/${number}`
    const [metadata, changedFiles] = await Promise.all([
      ghJson(endpoint),
      ghPages(`${endpoint}/files?per_page=100`),
    ])
    const pr = pullSchema.parse(metadata)
    const inputs = z.array(fileSchema).parse(changedFiles)
    if (pr.changed_files != null && inputs.length !== pr.changed_files)
      throw new UserError(
        'GitHub did not return every changed file. This PR is too large to load completely.',
      )
    const files = inputs.map((file) =>
      parseFile({
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      }),
    )
    const mergeBaseSha = await mergeBase({
      owner,
      repo,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
    })
    const warnings: string[] = []
    const incomplete = files.filter((file) => file.coverage !== 'complete')
    if (incomplete.length)
      warnings.push(
        `${incomplete.length} file(s) have an incomplete or unavailable patch. Open those files on GitHub to finish reviewing them.`,
      )
    // Bounded retrieval supplies original text for copy matches; unchanged files outside the PR are not scanned.
    const candidates = files
      .filter((file) => file.status !== 'added' && file.status !== 'removed')
      .slice(0, 30)
    let unavailableOriginals = 0
    for (let offset = 0; offset < candidates.length; offset += 5) {
      await Promise.all(
        candidates.slice(offset, offset + 5).map(async (file) => {
          try {
            const path = (file.previousPath ?? file.path)
              .split('/')
              .map(encodeURIComponent)
              .join('/')
            const content = z.string().parse(
              await github.rest(`repos/${owner}/${repo}/contents/${path}?ref=${mergeBaseSha}`, {
                raw: true,
                headers: ['Accept: application/vnd.github.raw+json'],
              }),
            )
            if (content.length <= 150_000) file.oldContent = content
            else unavailableOriginals++
          } catch {
            unavailableOriginals++
          }
        }),
      )
    }
    if (
      unavailableOriginals ||
      candidates.length <
        files.filter((file) => file.status !== 'added' && file.status !== 'removed').length
    )
      warnings.push(
        'Copy matching is limited to available original content from the first 30 changed source files.',
      )
    const current = pullSchema.parse(await ghJson(endpoint))
    if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha)
      throw new UserError(
        'The PR changed while it was loading. Please reload it to get a consistent diff.',
      )
    return {
      id: createHash('sha256')
        .update(`${owner}/${repo}/${number}/${pr.base.sha}/${pr.head.sha}`)
        .digest('hex')
        .slice(0, 24),
      owner,
      repo,
      number,
      url: pr.html_url,
      title: pr.title,
      description: pr.body ?? '',
      author: pr.user.login,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      baseSha: pr.base.sha,
      mergeBaseSha,
      headSha: pr.head.sha,
      state: pr.merged ? 'merged' : pr.state,
      files,
      groups: fileGroups(files),
      transfers: detectTransfers(files),
      groupingSource: 'files',
      warnings,
    }
  }

  async function submitReview(pr: PullRequest, draft: ReviewDraft, event: ReviewEvent) {
    const payload = buildGitHubReview(pr, draft, event)
    const endpoint = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`
    const current = pullSchema.parse(await ghJson(endpoint))
    if (current.head.sha !== pr.headSha || current.base.sha !== pr.baseSha)
      throw new UserError(
        'New commits arrived since this review was loaded. Reload the PR and revisit your comments before submitting.',
      )
    if (current.state !== 'open') throw new UserError('This pull request is no longer open.')
    const result = z
      .object({ html_url: z.string(), id: z.number() })
      .parse(await github.rest(`${endpoint}/reviews`, { method: 'POST', body: payload }))
    return { url: result.html_url, id: result.id }
  }

  return { fetchPullRevision, listRepositories, getInbox, fetchPull, submitReview }
}

// Stateless conveniences for CLI consumers; servers use their own service instance.
export const fetchPull = (url: string) => createPullService().fetchPull(url)
export const fetchPullRevision = (pull: PullRequest) => createPullService().fetchPullRevision(pull)

function validateRepository(repository: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new UserError('Select a repository in owner/name format.')
}
