import { Router } from 'express'
import { z } from 'zod'
import { setupRequestSchema, workspaceSetupSchema } from '../../shared/workspaceSetup'
import type { PullRequest } from '../../shared/types'
import type { SourceProject } from '../sourceWorkspace'
import type { WorkspaceSetups } from '../workspaceSetup'

export function workspaceSetupRouter(options: {
  setups: WorkspaceSetups
  getPull: (id: string) => PullRequest
  project: SourceProject
}) {
  const router = Router()
  router.get('/workspace-setups', (_request, response) =>
    response.json(z.array(workspaceSetupSchema).parse(options.setups.list())),
  )
  router.get('/workspace-setups/:id', (request, response) =>
    response.json(workspaceSetupSchema.parse(options.setups.get(request.params.id))),
  )
  router.post('/pulls/:id/workspace-setup', async (request, response) => {
    const body = setupRequestSchema.parse(request.body)
    const pull = options.getPull(request.params.id)
    const tree = await options.project.tree(pull, body.side)
    if (!tree.paths.includes(body.path))
      throw new Error('Select a committed source file before planning setup.')
    response
      .status(202)
      .json(workspaceSetupSchema.parse(options.setups.start(pull, tree.sha, body)))
  })
  router.post('/pulls/:id/workspace-setup/:jobId/approve', async (request, response) => {
    const body = z
      .object({ approved: z.literal(true), side: setupRequestSchema.shape.side })
      .strict()
      .parse(request.body)
    const pull = options.getPull(request.params.id)
    const tree = await options.project.tree(pull, body.side)
    response
      .status(202)
      .json(
        workspaceSetupSchema.parse(options.setups.approve(request.params.jobId, pull, tree.sha)),
      )
  })
  router.delete('/workspace-setups/:id', async (request, response) =>
    response.json(workspaceSetupSchema.parse(await options.setups.remove(request.params.id))),
  )
  return router
}
