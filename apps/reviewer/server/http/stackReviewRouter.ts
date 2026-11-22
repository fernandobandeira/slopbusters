import * as records from '../../shared/api/stackReviewRecords'
import { Router } from 'express'
import * as routes from '../../shared/api/stackReview'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function stackReviewRouter({ stackReviewJobs, stackRecords }: Services) {
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
  handle(router, records.getStackRecords, ({ params }) => stackRecords.read(params.id))
  handle(router, records.putStackAnswer, ({ params, body }) => stackRecords.answer(params.id, body))
  handle(router, records.putStackAnswers, ({ params, body }) =>
    stackRecords.bulk(params.id, body.answers),
  )
  handle(router, records.reopenStackAnswer, ({ params, body }) =>
    stackRecords.reopen(params.id, body),
  )
  handle(router, records.putStackDisposition, ({ params, body }) =>
    stackRecords.disposition(params.id, body),
  )
  return router
}
