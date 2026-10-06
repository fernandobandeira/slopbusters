import type { AgentSessions } from '../agent-sessions/agentSessions'
import type { BobAdvice } from '../../../shared/domain/bob'
import { organizationDefaults } from '../../../shared/domain/preferences'
import { Provider, type PullRequest } from '../../../shared/domain/types'
import { loadBobSkill, reviewWithBob, reconcileWithBob } from './bobReview'
import { DualReviewJobs } from '../dualReviewJobs'
import { UserError } from '../../errors'
import { fetchPull } from '../pulls/github'
import type { RepositoryContext } from '../../adapters/repositoryTools'
import type { ReviewerStore } from '../../adapters/store'

export class BobJobs extends DualReviewJobs<BobAdvice> {
  constructor(options: {
    store: ReviewerStore
    sessions?: AgentSessions
    staticDirectory: string
    skillDirectory?: string
    openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<RepositoryContext>
    loadPull?: typeof fetchPull
  }) {
    const { store, staticDirectory, skillDirectory, openRepository, loadPull = fetchPull } = options
    super({
      name: 'Bob',
      sessions: options.sessions,
      models: () => {
        const { organization: primary, companion } = store.getPreferences()
        if (!primary) throw new UserError('Choose your primary model in Settings first.')
        const provider = primary.provider === Provider.codex ? Provider.claude : Provider.codex
        if (companion?.provider === primary.provider)
          throw new UserError(
            'Bob needs both Codex and Claude. Choose a companion from the other provider in Settings.',
          )
        return {
          primary,
          companion: companion ?? { provider, model: organizationDefaults[provider].model },
        }
      },
      skill: () => loadBobSkill(staticDirectory, skillDirectory),
      save: (session) => {
        store.saveBobSession(session)
      },
      get: (id) => store.getBobSession(id),
      latest: (repository) => store.latestBobSession(repository),
      loadPull,
      openRepository,
      review: reviewWithBob,
      reconcile: reconcileWithBob,
    })
  }
}
