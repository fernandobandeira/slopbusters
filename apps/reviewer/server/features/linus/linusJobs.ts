import type { LinusAdvice } from '../../../shared/domain/linus'
import { organizationDefaults } from '../../../shared/domain/preferences'
import { Provider, type PullRequest } from '../../../shared/domain/types'
import { fetchPull } from '../pulls/github'
import { UserError } from '../../errors'
import type { RepositoryContext } from '../../adapters/repositoryTools'
import { loadLinusSkill, reconcileWithLinus, reviewWithLinus } from './linusReview'
import { DualReviewJobs } from '../dualReviewJobs'
import type { ReviewerStore } from '../../adapters/store'

export class LinusJobs extends DualReviewJobs<LinusAdvice> {
  constructor(
    store: ReviewerStore,
    staticDirectory: string,
    skillDirectory?: string,
    ...dependencies: [
      openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<RepositoryContext>,
      loadPull?: typeof fetchPull,
    ]
  ) {
    const [openRepository, loadPull = fetchPull] = dependencies
    super({
      name: 'Linus',
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
      openRepository,
      review: ({ pull, model, skill, signal, companion, repository }) =>
        repository
          ? reviewWithLinus(pull, model, skill, signal, companion, repository)
          : reviewWithLinus(pull, model, skill, signal, companion),
      reconcile: ({ pending, model, skill, signal, repository }) =>
        repository
          ? reconcileWithLinus(pending, model, skill, signal, repository)
          : reconcileWithLinus(pending, model, skill, signal),
    })
  }
}
