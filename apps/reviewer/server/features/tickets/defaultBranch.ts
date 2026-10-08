import { z } from 'zod'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitHub } from '../../adapters/github'

const repositorySchema = z.object({ default_branch: z.string().min(1) })
const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) })

/**
 * A ticket has no PR head to inspect, so Jobs reads the default branch. The review workspace and
 * repository tools take a PR snapshot; this one has no changes and names the same commit twice.
 */
export async function defaultBranchSnapshot(
  github: GitHub,
  repository: string,
  signal?: AbortSignal,
): Promise<PullRequest> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) throw new Error('Invalid source repository.')
  const { default_branch: branch } = repositorySchema.parse(
    await github.rest(`repos/${owner}/${repo}`, { signal }),
  )
  const { commit } = branchSchema.parse(
    await github.rest(`repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { signal }),
  )
  return {
    id: `branch:${owner}/${repo}@${commit.sha}`,
    url: `https://github.com/${owner}/${repo}/tree/${commit.sha}`,
    owner,
    repo,
    number: 0,
    title: '',
    description: '',
    author: '',
    baseBranch: branch,
    headBranch: branch,
    baseSha: commit.sha,
    mergeBaseSha: commit.sha,
    headSha: commit.sha,
    state: 'open',
    files: [],
    groups: [],
    transfers: [],
    groupingSource: 'files',
    warnings: [],
  }
}
