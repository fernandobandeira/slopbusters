import { z } from 'zod'
import type { PullRequest } from '../../shared/domain/types'
import { repositoryQuery } from '../../shared/api/contract'
import { UserError } from '../errors'
import type { GitHub } from './github'

const branchSchema = z.object({
  ref: z.string(),
  repo: z.object({ full_name: z.string() }).nullable(),
})
const metadataSchema = z.object({
  state: z.enum(['open', 'closed']),
  head: branchSchema,
  base: branchSchema,
})
const tipSchema = z.object({ object: z.object({ sha: z.string().regex(/^[a-f\d]{40,64}$/) }) })
const comparisonSchema = z.object({ status: z.enum(['ahead', 'behind', 'diverged', 'identical']) })

/** The base only gained commits, so a merge of its earlier tip is still a valid update. */
export class BaseAdvancedError extends UserError {
  constructor() {
    super(
      'The base branch kept gaining commits during conflict resolution. Retry the remaining PRs.',
    )
    this.name = 'BaseAdvancedError'
  }
}

/** PR base.sha can lag behind a branch update, especially for native stacks. */
export async function readConflictRevision(github: GitHub, pull: PullRequest, signal: AbortSignal) {
  const metadata = metadataSchema.parse(
    await github.rest(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`, { signal }),
  )
  if (
    metadata.state !== 'open' ||
    metadata.head.ref !== pull.headBranch ||
    metadata.base.ref !== pull.baseBranch
  )
    throw new UserError('This PR changed during conflict resolution. Refresh it and retry.')
  const headRepository = repositoryName(metadata.head)
  const baseRepository = repositoryName(metadata.base)
  const [headSha, baseSha] = await Promise.all([
    branchTip(github, headRepository, metadata.head.ref, signal),
    branchTip(github, baseRepository, metadata.base.ref, signal),
  ])
  return { headRepository, baseRepository, headSha, baseSha }
}

type ConflictRevision = Awaited<ReturnType<typeof readConflictRevision>>

/** Rejects any change to the PR since `expected`, reporting a base that only gained commits apart. */
export async function verifyConflictRevision(
  github: GitHub,
  pull: PullRequest,
  expected: ConflictRevision,
  signal: AbortSignal,
) {
  const current = await readConflictRevision(github, pull, signal)
  if (JSON.stringify(current) === JSON.stringify(expected)) return
  if (
    JSON.stringify({ ...current, baseSha: expected.baseSha }) === JSON.stringify(expected) &&
    (await fastForwards(github, expected, current.baseSha, signal))
  )
    throw new BaseAdvancedError()
  throw new UserError('This PR changed during conflict resolution. Refresh it and retry.')
}

async function fastForwards(
  github: GitHub,
  previous: ConflictRevision,
  baseSha: string,
  signal: AbortSignal,
) {
  const value = await github.rest(
    `repos/${previous.baseRepository}/compare/${previous.baseSha}...${baseSha}?per_page=1`,
    { signal },
  )
  return comparisonSchema.parse(value).status === 'ahead'
}

function repositoryName(branch: z.infer<typeof branchSchema>) {
  if (!branch.repo) throw new UserError('The PR repository is no longer available.')
  return repositoryQuery.parse({ repository: branch.repo.full_name }).repository
}

async function branchTip(github: GitHub, repository: string, branch: string, signal: AbortSignal) {
  const value = await github.rest(
    `repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
    {
      signal,
    },
  )
  return tipSchema.parse(value).object.sha
}
