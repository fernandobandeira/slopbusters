import type { AgentSessions } from '../agent-sessions/agentSessions'
import type { BobAdvice } from '../../../shared/domain/bob'
import { savedModels } from '../models'
import type { PullRequest } from '../../../shared/domain/types'
import { loadBobSkill, reviewWithBob, reconcileWithBob } from './bobReview'
import { DualReviewJobs } from '../dualReviewJobs'
import { fetchPull } from '../pulls/github'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import type { ReviewerStore } from '../../adapters/store'

export class BobJobs extends DualReviewJobs<BobAdvice> {
  constructor(options: {
    store: ReviewerStore
    turns: StructuredTurns
    sessions?: AgentSessions
    staticDirectory: string
    skillDirectory?: string
    openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
    loadPull?: typeof fetchPull
    context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
  }) {
    const {
      store,
      turns,
      staticDirectory,
      skillDirectory,
      openRepository,
      loadPull = fetchPull,
    } = options
    super({
      name: 'Bob',
      kind: 'bob',
      sessions: options.sessions,
      models: () => savedModels(store.getPreferences()),
      skill: () => loadBobSkill(staticDirectory, skillDirectory),
      save: (session) => {
        store.saveBobSession(session)
      },
      get: (id) => store.getBobSession(id),
      latest: (repository) => store.latestBobSession(repository),
      loadPull,
      openRepository,
      context: options.context,
      review: (request) => reviewWithBob({ ...request, turns }),
      reconcile: (request) => reconcileWithBob({ ...request, turns }),
    })
  }
}
