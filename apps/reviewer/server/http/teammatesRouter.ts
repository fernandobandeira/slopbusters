import { Router } from 'express'
import * as routes from '../../shared/api/teammates'
import { UserError } from '../errors'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function teammatesRouter({ teammates }: Services) {
  const router = Router()
  handle(router, routes.listInstalledSkills, async () => ({
    skills: await teammates.installedSkills(),
  }))
  handle(router, routes.listTeammates, async () => ({ teammates: await teammates.list() }))
  handle(router, routes.createTeammate, ({ body }, _request, response) => {
    response.status(201)
    return teammates.create(body)
  })
  handle(router, routes.updateTeammate, ({ params, body }) => teammates.update(params.id, body))
  handle(router, routes.removeTeammate, async ({ params }) => {
    await teammates.remove(params.id)
    return { ok: true as const }
  })
  handle(router, routes.saveTeammateAvatar, ({ params, body }) =>
    teammates.saveAvatar(params.id, params.mood, body.png),
  )
  handle(router, routes.removeTeammateAvatar, ({ params }) =>
    teammates.removeAvatar(params.id, params.mood),
  )
  router.get(routes.teammateAvatarPath, async (request, response) => {
    const params = routes.avatarParams.safeParse(request.params)
    if (!params.success) throw new UserError('The request contained invalid data.')
    const png = await teammates.avatar(params.data.id, params.data.mood)
    if (!png) throw new UserError('This teammate has no face yet.', 404)
    response
      .type('image/png')
      .set({ 'Cache-Control': 'private, max-age=31536000, immutable' })
      .send(png)
  })
  return router
}
