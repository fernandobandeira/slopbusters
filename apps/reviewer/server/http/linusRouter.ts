import { Router } from 'express'
import * as routes from '../../shared/api/linus'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function linusRouter({ linusJobs, store }: Services) {
  const router = Router()
  handle(router, routes.latestLinus, ({ query }) => ({
    session: linusJobs.latest(query.repository) ?? null,
  }))
  handle(router, routes.linusRecommendations, ({ query }) => ({
    recommendations: store.linusRecommendations(query.repository),
  }))
  handle(router, routes.startLinus, ({ body }, _request, response) => {
    for (const url of body.urls) {
      const pull = parsePullUrl(url)
      if (`${pull.owner}/${pull.repo}` !== body.repository)
        throw new UserError('Select PRs from the current repository.')
    }
    if (new Set(body.urls).size !== body.urls.length)
      throw new UserError('Select each PR only once.')
    response.status(202)
    return linusJobs.start(body.repository, body.urls)
  })
  handle(router, routes.getLinus, ({ params }) => linusJobs.get(params.id))
  handle(router, routes.continueLinus, ({ params }, _request, response) => {
    response.status(202)
    return linusJobs.continue(params.id)
  })
  handle(router, routes.retryLinus, ({ params }, _request, response) => {
    response.status(202)
    return linusJobs.retry(params.id)
  })
  handle(router, routes.cancelLinus, ({ params }) => linusJobs.cancel(params.id))
  return router
}
