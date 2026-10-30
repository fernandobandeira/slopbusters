import { Router } from 'express'
import * as routes from '../../shared/api/split'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function splitRouter({ splitJobs, linusJobs }: Services) {
  const router = Router()
  handle(router, routes.latestSplit, ({ query }) => ({
    session: splitJobs.latest(query.repository, query.url) ?? null,
  }))
  handle(router, routes.startSplit, ({ body }, _request, response) => {
    const pull = parsePullUrl(body.url)
    if (`${pull.owner}/${pull.repo}` !== body.repository)
      throw new UserError('Choose a PR from the current repository.')
    const plan = body.linusSessionId
      ? linusJobs.get(body.linusSessionId).results.find((result) => result.pull.url === body.url)
          ?.advice.layers
      : undefined
    response.status(202)
    const session = splitJobs.start(body.repository, body.url, {
      plan,
      guidance: body.guidance,
      linusSessionId: body.linusSessionId,
    })
    if (body.linusSessionId) linusJobs.recordSplit(body.linusSessionId, body.url, session.id)
    return session
  })
  handle(router, routes.getSplit, ({ params }) => splitJobs.get(params.id))
  handle(router, routes.retrySplit, ({ params }, _request, response) => {
    response.status(202)
    return splitJobs.retry(params.id)
  })
  handle(router, routes.cancelSplit, ({ params }) => splitJobs.cancel(params.id))
  return router
}
