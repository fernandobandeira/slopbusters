import { z } from 'zod'
import { splitSessionSchema } from '../domain/split'
import { defineRoute, idParams, pullUrlSchema, repositoryQuery } from './contract'

export const latestSplit = defineRoute('GET', '/split/latest', {
  query: repositoryQuery.extend({ url: pullUrlSchema.optional() }),
  response: z.object({ session: splitSessionSchema.nullable() }),
})
/** Split a PR into the stack Linus proposed; his review supplies the layers to start from. */
export const startSplit = defineRoute('POST', '/split', {
  request: repositoryQuery
    .extend({
      url: pullUrlSchema,
      linusSessionId: z.string().min(1).optional(),
      guidance: z.string().trim().min(1).max(4000).optional(),
    })
    .strict(),
  response: splitSessionSchema,
})
export const getSplit = defineRoute('GET', '/split/:id', {
  params: idParams,
  response: splitSessionSchema,
})
export const retrySplit = defineRoute('POST', '/split/:id/retry', {
  params: idParams,
  response: splitSessionSchema,
})
export const cancelSplit = defineRoute('DELETE', '/split/:id', {
  params: idParams,
  response: splitSessionSchema,
})
