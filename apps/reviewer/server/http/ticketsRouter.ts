import { Router } from 'express'
import * as routes from '../../shared/api/tickets'
import type { LinearStatus } from '../../shared/domain/tickets'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function ticketsRouter(services: Services) {
  const router = Router()
  const { linearAuth, tickets } = services
  async function status(): Promise<LinearStatus> {
    return {
      ...(await tickets.status()),
      method: linearAuth.method(),
      oauthAvailable: linearAuth.oauthAvailable(),
      connecting: linearAuth.connecting(),
    }
  }
  handle(router, routes.getLinearStatus, status)
  handle(router, routes.connectLinear, async () => ({ url: await linearAuth.begin() }))
  handle(router, routes.saveLinearKey, async ({ body }) => {
    const previous = linearAuth.method()
    linearAuth.saveKey(body.key)
    const result = await status()
    if (result.connected) return result
    if (previous === 'none') await linearAuth.disconnect()
    throw new UserError(result.detail)
  })
  handle(router, routes.disconnectLinear, async () => {
    await linearAuth.disconnect()
    return status()
  })
  handle(router, routes.listTickets, ({ query }) => tickets.list(query.view, query.after))
  handle(router, routes.getTicket, ({ params }) =>
    tickets.get(params.identifier, { refresh: true }),
  )
  handle(router, routes.ticketForPull, async ({ query }) => ({
    identifier: linearAuth.configured() ? await tickets.forPullUrl(query.url) : null,
  }))
  return router
}
