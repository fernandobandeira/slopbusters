import { Router } from 'express'
import * as routes from '../../shared/api/gandalf'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function gandalfRouter({ gandalfJobs }: Services) {
  const router = Router()
  handle(router, routes.latestGandalf, ({ query }) => ({
    session: gandalfJobs.latest(query.repository) ?? null,
  }))
  handle(router, routes.startGandalf, ({ body }, _request, response) => {
    if (new Set(body.urls).size !== body.urls.length)
      throw new UserError('Select each PR only once.')
    for (const url of body.urls) {
      const pull = parsePullUrl(url)
      if (`${pull.owner}/${pull.repo}` !== body.repository)
        throw new UserError('Select PRs from the current repository.')
    }
    response.status(202)
    return gandalfJobs.start(body.repository, body.urls)
  })
  handle(router, routes.getGandalf, ({ params }) => gandalfJobs.get(params.id))
  handle(router, routes.retryGandalf, ({ params }, _request, response) => {
    response.status(202)
    return gandalfJobs.retry(params.id)
  })
  handle(router, routes.cancelGandalf, ({ params }) => gandalfJobs.cancel(params.id))
  return router
}
