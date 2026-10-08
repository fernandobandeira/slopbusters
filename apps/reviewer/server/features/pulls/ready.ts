import { z } from 'zod'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitHub } from '../../adapters/github'
import { UserError } from '../../errors'

const currentPullSchema = z.object({
  node_id: z.string(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  head: z.object({ sha: z.string() }),
  base: z.object({ sha: z.string() }),
})

export async function markPullReady(pull: PullRequest, github: GitHub): Promise<void> {
  const current = currentPullSchema.parse(
    await github.rest(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`),
  )
  if (current.state !== 'open') throw new UserError('This pull request is no longer open.')
  if (current.head.sha !== pull.headSha || current.base.sha !== pull.baseSha)
    throw new UserError(
      'New commits arrived since this review was loaded. Reload the PR before marking it ready for review.',
    )
  if (!current.draft) return
  const result = await github.graphql(
    `mutation($pullRequestId: ID!) {
      markPullRequestReadyForReview(input: {pullRequestId: $pullRequestId}) {
        pullRequest { isDraft }
      }
    }`,
    { pullRequestId: current.node_id },
  )
  z.object({
    data: z.object({
      markPullRequestReadyForReview: z.object({
        pullRequest: z.object({ isDraft: z.literal(false) }),
      }),
    }),
  }).parse(result)
}
