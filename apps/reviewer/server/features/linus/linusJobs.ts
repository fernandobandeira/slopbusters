import type { AgentSessions } from '../agent-sessions/agentSessions'
import type { LinusAdvice } from '../../../shared/domain/linus'
import { organizationDefaults } from '../../../shared/domain/preferences'
import { Provider, type PullRequest } from '../../../shared/domain/types'
import { fetchPull } from '../pulls/github'
import { UserError } from '../../errors'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { loadLinusSkill, reconcileWithLinus, reviewWithLinus } from './linusReview'
import { DualReviewJobs } from '../dualReviewJobs'
import type { ReviewerStore } from '../../adapters/store'

export class LinusJobs extends DualReviewJobs<LinusAdvice> {
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
    const { store, turns, staticDirectory, skillDirectory, loadPull = fetchPull } = options
    super({
      name: 'Linus',
      kind: 'linus',
      sessions: options.sessions,
      models: () => {
        const { organization: primary, companion } = store.getPreferences()
        if (!primary) throw new UserError('Choose your primary model in Settings first.')
        return {
          primary,
          companion: companion ?? {
            provider: Provider.claude,
            model: organizationDefaults.claude.model,
          },
        }
      },
      skill: () => loadLinusSkill(staticDirectory, skillDirectory),
      save: (session) => {
        store.saveLinusSession(session)
      },
      get: (id) => store.getLinusSession(id),
      latest: (repository) => store.latestLinusSession(repository),
      loadPull,
      openRepository: options.openRepository,
      context: options.context,
      review: (request) => reviewWithLinus({ ...request, turns }),
      reconcile: (request) => reconcileWithLinus({ ...request, turns }),
    })
  }
}
