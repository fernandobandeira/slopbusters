import type { ReviewerStore } from './adapters/store'
import { parsePullUrl } from '../shared/domain/pullUrl'
import { StackReviewRecords } from './features/stack-review/stackReviewRecords'
import { StackReviewJobs } from './features/stack-review/stackReviewJobs'
import type { createPullService } from './features/pulls/github'
import { createStackResolver } from './features/stack-review/stackResolution'
type StackOptions = ConstructorParameters<typeof StackReviewJobs>[0]

export function createStackReviewServices({
  store,
  retryingTurns,
  agentSessions,
  panelJobs,
  panelMembers,
  models,
  stacks,
  pulls,
  judges,
}: {
  store: ReviewerStore
  retryingTurns: StackOptions['turns']
  agentSessions: StackOptions['sessions']
  panelJobs: StackOptions['panels']
  panelMembers: StackOptions['members']
  models: StackOptions['models']
  stacks: { getStackMetadata: Parameters<typeof createStackResolver>[0] }
  pulls: Pick<ReturnType<typeof createPullService>, 'fetchPullRevision'>
  judges: StackOptions['judges']
}) {
  const revision = (url: string) => pulls.fetchPullRevision(parsePullUrl(url))
  const stackReviewJobs = new StackReviewJobs({
    store: store.stackReview,
    turns: retryingTurns,
    sessions: agentSessions,
    panels: panelJobs,
    members: panelMembers,
    models,
    results: (name, url) => store.panel.results(name, url, 3),
    resolve: createStackResolver(stacks.getStackMetadata),
    revision,
    judges,
  })
  const stackRecords = new StackReviewRecords({
    store: store.stackRecords,
    get: (id) => stackReviewJobs.get(id),
    applied: (id) => store.layerFixes.appliedForStack(id),
    revision: async (url) => {
      const { headSha, baseSha } = await revision(url)
      return { head: headSha, base: baseSha }
    },
  })
  return { stackReviewJobs, stackRecords }
}
