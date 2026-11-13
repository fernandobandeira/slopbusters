import { Router } from 'express'
import * as routes from '../../shared/api/stackReview'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function stackReviewRouter({ stackReviewJobs }: Services) {
  const router = Router()
  handle(router, routes.latestStackReview, ({ query }) => ({
    session: stackReviewJobs.latest(query.repository, [query.url]) ?? null,
  }))
  handle(router, routes.startStackReview, async ({ body }, _request, response) => {
    const session = await stackReviewJobs.start(body.url, body.reviewers)
    response.status(202)
    return session
  })
  handle(router, routes.getStackReview, ({ params }) => stackReviewJobs.get(params.id))
  handle(router, routes.retryStackReview, ({ params }, _request, response) => {
    response.status(202)
    return stackReviewJobs.retry(params.id)
  })
  handle(router, routes.cancelStackReview, ({ params }) => stackReviewJobs.cancel(params.id))
  return router
}
