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
