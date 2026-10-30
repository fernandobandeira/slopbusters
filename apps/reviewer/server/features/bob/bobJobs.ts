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
        store.bob.save(session)
      },
      get: (id) => store.bob.get(id),
      latest: (repository) => store.bob.latest(repository),
      loadPull,
      openRepository,
      context: options.context,
      review: (request) => reviewWithBob({ ...request, turns }),
      reconcile: (request) => reconcileWithBob({ ...request, turns }),
    })
  }
}
