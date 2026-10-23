import { Router } from 'express'
import * as routes from '../../shared/api/panel'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function panelRouter({
  panelJobs,
  panelGates,
  panelFixes,
  panelRoutes,
  fixChecks,
  store,
}: Services) {
  const router = Router()
  handle(router, routes.savedPanelReviews, ({ query }) => ({
    reviews: store.panel.reviews(query.repository),
  }))
  handle(router, routes.latestPanel, ({ query }) => ({
    session: panelJobs.latest(query.repository, query.url) ?? null,
  }))
  handle(router, routes.startPanel, async ({ body }, _request, response) => {
    for (const url of body.urls) {
      const pull = parsePullUrl(url)
      if (`${pull.owner}/${pull.repo}` !== body.repository)
        throw new UserError('Select PRs from the current repository.')
    }
    if (new Set(body.urls).size !== body.urls.length)
      throw new UserError('Select each PR only once.')
    const session = await panelJobs.start(body.repository, body.urls, body.reviewers)
    response.status(202)
    return session
  })
  handle(router, routes.getPanel, ({ params }) => panelJobs.get(params.id))
  handle(router, routes.continuePanel, ({ params }, _request, response) => {
    response.status(202)
    return panelJobs.continue(params.id)
  })
  handle(router, routes.retryPanel, ({ params }, _request, response) => {
    response.status(202)
    return panelJobs.retry(params.id)
  })
  handle(router, routes.savePanelGate, ({ params, body }) =>
    panelGates.save(params.id, body.url, body.gate),
  )
  handle(router, routes.planPanelFix, ({ params, body }) =>
    panelGates.plan(params.id, body.url, body.entry),
  )
  handle(router, routes.proceedPanelFixes, ({ params, body }) =>
    panelFixes.proceed(params.id, body.url, body.revision),
  )
  handle(router, routes.routePanelLayer, ({ params, body }) =>
    panelRoutes.toLayer(params.id, body.url, body.pull),
  )
  handle(router, routes.draftPanelMetadata, ({ params, body }) =>
    panelRoutes.draftMetadata(params.id, body.url, body.field),
  )
  handle(router, routes.reviewLocalFixes, ({ params, body }, _request, response) => {
    response.status(202)
    return panelFixes.reviewLocal(params.id, body.url)
  })
  handle(router, routes.checkLocalFixes, ({ params, body }) => fixChecks.check(params.id, body.url))
  handle(router, routes.cancelPanel, ({ params }) => panelJobs.cancel(params.id))
  return router
}
