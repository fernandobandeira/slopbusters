import { Router } from 'express'
import * as routes from '../../shared/api/source'
import type { Services } from '../services'
import { handle } from './contractRouter'
import { symbolImplementationSupport } from '../features/navigation/symbolImplementationSupport'

export function sourceRouter(services: Services) {
  const router = Router()
  const { store, loadFileContent, sourceProject, workspaces } = services
  handle(router, routes.getFileContent, async ({ params }) => {
    const pull = store.getPull(params.id)
    const content = await loadFileContent(pull, params.fileId)
    if (!pull.mergeBaseSha && content.old)
      store.savePull({ ...store.getPull(pull.id), mergeBaseSha: content.old.sha })
    return content
  })
  handle(router, routes.getSourceTree, ({ params, query }) =>
    sourceProject.tree(store.getPull(params.id), query.side),
  )
  handle(router, routes.getSourceFile, ({ params, query }) =>
    sourceProject.file(store.getPull(params.id), query.side, query.path),
  )
  handle(router, routes.getWorkspace, async ({ params, query }) => {
    const pull = store.getPull(params.id)
    const tree = await sourceProject.tree(pull, query.side)
    return workspaces.status(pull, tree.sha)
  })
  handle(router, routes.prepareWorkspace, async ({ params, body }) => {
    const pull = store.getPull(params.id)
    const tree = await sourceProject.tree(pull, body.side)
    const lease = await workspaces.acquire(pull, tree.sha)
    lease.release()
    return workspaces.status(pull, tree.sha)
  })
  handle(router, routes.navigateSource, ({ params, body }) =>
    services.navigateSource(store.getPull(params.id), body),
  )
  handle(router, routes.getSymbolActions, async ({ params, body }) => {
    const file = await sourceProject.file(store.getPull(params.id), body.side, body.path)
    return {
      implementation: symbolImplementationSupport(file.path, file.content, body.line, body.column),
    }
  })
  return router
}
