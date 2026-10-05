import { Router } from 'express'
import * as routes from '../../shared/api/bob'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function bobRouter({ bobJobs, store }: Services) {
  const router = Router()
  handle(router, routes.savedBobReviews, ({ query }) => ({
    reviews: store.bobReviews(query.repository),
  }))
  handle(router, routes.latestBob, ({ query }) => {
    const saved = store.latestBobSession(query.repository, query.url)
    return { session: saved ? bobJobs.get(saved.id) : null }
  })
  handle(router, routes.startBob, ({ body }, _request, response) => {
    for (const url of body.urls) {
      const pull = parsePullUrl(url)
      if (`${pull.owner}/${pull.repo}` !== body.repository)
        throw new UserError('Select PRs from the current repository.')
    }
    if (new Set(body.urls).size !== body.urls.length)
      throw new UserError('Select each PR only once.')
    response.status(202)
    return bobJobs.start(body.repository, body.urls)
  })
  handle(router, routes.getBob, ({ params }) => bobJobs.get(params.id))
  handle(router, routes.continueBob, ({ params }, _request, response) => {
    response.status(202)
    return bobJobs.continue(params.id)
  })
  handle(router, routes.retryBob, ({ params }, _request, response) => {
    response.status(202)
    return bobJobs.retry(params.id)
  })
  handle(router, routes.cancelBob, ({ params }) => bobJobs.cancel(params.id))
  return router
}
