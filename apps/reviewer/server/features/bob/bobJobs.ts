import type { BobAdvice } from '../../../shared/domain/bob'
import { savedModels } from '../models'
import { loadBobSkill, reviewWithBob, reconcileWithBob } from './bobReview'
import { DualReviewJobs, type DualReviewDependencies } from '../dualReviewJobs'
import { fetchPull } from '../pulls/github'

export class BobJobs extends DualReviewJobs<BobAdvice> {
  constructor(options: DualReviewDependencies) {
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
