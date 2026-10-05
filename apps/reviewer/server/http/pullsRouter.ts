import { Router } from 'express'
import { z } from 'zod'
import * as routes from '../../shared/api/pulls'
import { fetchDiscussions, replyToThread } from '../features/pulls/discussions'
import { getAppStatus } from '../adapters/toolStatus'
import { ReviewNotFoundError } from '../adapters/store'
import { UserError, logError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function pullsRouter(services: Services) {
  const router = Router()
  const { store, pulls, statuses, stacks, checkRevision, github } = services
  handle(router, routes.getStatus, () => getAppStatus(github))
  handle(router, routes.getRepositories, () => pulls.listRepositories())
  handle(router, routes.getInbox, ({ query }) => pulls.getInbox(query.repository))
  handle(router, routes.getInboxStatus, async ({ query }) => {
    try {
      const result = await statuses.fetchInboxStatuses(
        query.repository,
        query.refresh === '1',
        query.filter,
      )
      return { statuses: [...result].map(([number, status]) => ({ number, status })), warnings: [] }
    } catch (error) {
      logError('Loading inbox status', error)
      return {
        statuses: [],
        warnings: ['GitHub CI and review metadata is unavailable. Refresh the inbox to retry.'],
      }
    }
  })
  handle(router, routes.loadPull, async ({ body }) => {
    let pull = await pulls.fetchPull(body.url)
    try {
      const cached = store.getPull(pull.id)
      if (cached.groupingSource !== 'files')
        pull = { ...pull, groups: cached.groups, groupingSource: cached.groupingSource }
    } catch (error) {
      if (!(error instanceof ReviewNotFoundError)) throw error
    }
    store.savePull(pull)
    services.warmSource(pull)
    return pull
  })
  handle(router, routes.getPull, ({ params }) => {
    const pull = store.getPull(params.id)
    services.warmSource(pull)
    return pull
  })
  handle(router, routes.getPullStatus, ({ params }) =>
    statuses.fetchPullStatus(store.getPull(params.id).url, true),
  )
  handle(router, routes.getStatusByUrl, ({ query }) => statuses.fetchPullStatus(query.url, true))
  handle(router, routes.getPullStack, ({ params }) =>
    stacks.getStackForPull(store.getPull(params.id).url),
  )
  handle(router, routes.getStackByUrl, ({ query }) =>
    stacks.getStackForPull(query.url, { refresh: query.refresh === '1' }),
  )
  handle(router, routes.getPullRevision, ({ params }) => checkRevision(store.getPull(params.id)))
  registerReviewRoutes(router, services)
  return router
}

function registerReviewRoutes(router: Router, services: Services) {
  const { store, pulls, organizationJobs, github } = services
  handle(router, routes.getDraft, ({ params }) => store.getDraft(params.id))
  handle(router, routes.saveDraft, ({ params, body }, request) => {
    const writerId = request.get('X-Review-Writer')
    const sequence = request.get('X-Review-Sequence')
    const parsed = z
      .object({
        writerId: z.string().min(1).max(100),
        sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .safeParse({ writerId, sequence })
    const hasMetadata = writerId != null || sequence != null
    if (hasMetadata && !parsed.success) throw new UserError('The draft writer metadata is invalid.')
    const write = parsed.success ? parsed.data : undefined
    return store.saveDraft(params.id, body, write)
  })
  handle(router, routes.getThreads, ({ params }) =>
    fetchDiscussions(store.getPull(params.id), github),
  )
  handle(router, routes.replyToThread, ({ params, body }) =>
    replyToThread(
      { pr: store.getPull(params.id), threadId: params.threadId, body: body.body },
      github,
    ),
  )
  handle(router, routes.organizePull, ({ params, body }, _request, response) => {
    const result = organizationJobs.start(params.id, body.force)
    if (result.id) response.status(202)
    return result
  })
  handle(router, routes.getJob, ({ params }) => organizationJobs.get(params.id))
  handle(router, routes.cancelJob, ({ params }) => {
    organizationJobs.cancel(params.id)
    return { ok: true as const }
  })
  handle(router, routes.submitReview, ({ params, body }) =>
    pulls.submitReview(store.getPull(params.id), body.draft, body.event),
  )
  return router
}
