import { Router } from 'express'
import * as routes from '../../shared/api/jobs'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function jobsRouter({ jobs, store }: Services) {
  const router = Router()
  handle(router, routes.jobsReviews, () => ({ reviews: store.tickets.jobsReviews() }))
  handle(router, routes.latestJobs, ({ query }) => ({ session: jobs.latest(query.ticket) ?? null }))
  handle(router, routes.startJobs, ({ body }, _request, response) => {
    response.status(202)
    return jobs.start(body.ticket, body.repository)
  })
  handle(router, routes.getJobs, ({ params }) => jobs.get(params.id))
  handle(router, routes.answerJobs, ({ params, body }, _request, response) => {
    response.status(202)
    return jobs.answer(params.id, body.answers)
  })
  handle(router, routes.applyJobs, ({ params, body }) => jobs.apply(params.id, body))
  handle(router, routes.continueJobs, ({ params }, _request, response) => {
    response.status(202)
    return jobs.continue(params.id)
  })
  handle(router, routes.retryJobs, ({ params }, _request, response) => {
    response.status(202)
    return jobs.retry(params.id)
  })
  handle(router, routes.cancelJobs, ({ params }) => jobs.cancel(params.id))
  return router
}
