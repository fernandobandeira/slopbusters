import { Router } from 'express'
import * as routes from '../../shared/api/layerFix'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function layerFixRouter({ layerFixJobs }: Services) {
  const router = Router()
  handle(router, routes.startLayerFix, ({ body }) =>
    layerFixJobs.start(body.stack, body.url, body.entries),
  )
  handle(router, routes.latestLayerFix, ({ query }) => ({
    session: layerFixJobs.latest(query.url) ?? null,
  }))
  handle(router, routes.getLayerFix, ({ params }) => layerFixJobs.get(params.id))
  handle(router, routes.retryLayerFix, ({ params }) => layerFixJobs.retry(params.id))
  handle(router, routes.cancelLayerFix, ({ params }) => layerFixJobs.cancel(params.id))
  handle(router, routes.openLayerFix, async ({ params }) => {
    await layerFixJobs.open(params.id)
    return { ok: true as const }
  })
  return router
}
