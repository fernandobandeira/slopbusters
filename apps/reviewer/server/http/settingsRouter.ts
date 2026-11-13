import { Router } from 'express'
import * as routes from '../../shared/api/settings'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function settingsRouter(
  services: Services,
  mcpEndpoint: () => { url?: string; problem?: string },
) {
  const router = Router()
  handle(router, routes.getMcpEndpoint, mcpEndpoint)
  handle(router, routes.getPreferences, () => services.store.getPreferences())
  handle(router, routes.savePreferences, ({ body }) => services.store.savePreferences(body))
  handle(router, routes.getLanguageServers, () => services.languageServers.statuses())
  handle(router, routes.saveLanguageServers, ({ body }) => services.saveLanguageServers(body))
  handle(router, routes.getWorkspaces, () => services.workspaces.list())
  handle(router, routes.removeWorkspace, async ({ body }) => {
    await services.removeWorkspace(body)
    return { ok: true as const }
  })
  return router
}
