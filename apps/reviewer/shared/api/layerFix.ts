import { z } from 'zod'
import { layerFixSessionSchema } from '../domain/layerFix'
import { defineRoute, idParams, pullUrlSchema } from './contract'

export const startLayerFix = defineRoute('POST', '/layer-fixes', {
  request: z
    .object({ stack: z.string(), url: pullUrlSchema, entries: z.array(z.string()).optional() })
    .strict(),
  response: layerFixSessionSchema,
})
export const latestLayerFix = defineRoute('GET', '/layer-fixes/latest', {
  query: z.object({ url: pullUrlSchema }),
  response: z.object({ session: layerFixSessionSchema.nullable() }),
})
export const getLayerFix = defineRoute('GET', '/layer-fixes/:id', {
  params: idParams,
  response: layerFixSessionSchema,
})
export const retryLayerFix = defineRoute('POST', '/layer-fixes/:id/retry', {
  params: idParams,
  response: layerFixSessionSchema,
})
export const cancelLayerFix = defineRoute('DELETE', '/layer-fixes/:id', {
  params: idParams,
  response: layerFixSessionSchema,
})
export const openLayerFix = defineRoute('POST', '/layer-fixes/:id/open', {
  params: idParams,
  response: z.object({ ok: z.literal(true) }),
})
