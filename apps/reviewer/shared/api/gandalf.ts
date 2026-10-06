import { z } from 'zod'
import { gandalfSessionSchema } from '../domain/gandalf'
import { defineRoute, idParams, repositoryQuery, pullUrlSchema } from './contract'

export const latestGandalf = defineRoute('GET', '/gandalf/latest', {
  query: repositoryQuery,
  response: z.object({ session: gandalfSessionSchema.nullable() }),
})
export const startGandalf = defineRoute('POST', '/gandalf', {
  request: repositoryQuery.extend({ urls: z.array(pullUrlSchema).min(1).max(20) }).strict(),
  response: gandalfSessionSchema,
})
export const getGandalf = defineRoute('GET', '/gandalf/:id', {
  params: idParams,
  response: gandalfSessionSchema,
})
export const retryGandalf = defineRoute('POST', '/gandalf/:id/retry', {
  params: idParams,
  response: gandalfSessionSchema,
})
export const cancelGandalf = defineRoute('DELETE', '/gandalf/:id', {
  params: idParams,
  response: gandalfSessionSchema,
})
