import { z } from 'zod'
import { panelSeatRequestSchema } from '../domain/panel'
import { stackReviewSessionSchema } from '../domain/stackReview'
import { defineRoute, idParams, pullUrlSchema, repositoryQuery } from './contract'

/** The newest stack review that covered the PR. */
export const latestStackReview = defineRoute('GET', '/stack-review/latest', {
  query: repositoryQuery.extend({ url: pullUrlSchema }),
  response: z.object({ session: stackReviewSessionSchema.nullable() }),
})
/**
 * Review the whole stack a PR belongs to: the panel on every open layer without an up-to-date
 * result, then one pass across the layers. Without reviewers, the ones last used on the stack.
 */
export const startStackReview = defineRoute('POST', '/stack-review', {
  request: z
    .object({
      url: pullUrlSchema,
      reviewers: z.array(panelSeatRequestSchema).min(1).max(8).optional(),
    })
    .strict(),
  response: stackReviewSessionSchema,
})
export const getStackReview = defineRoute('GET', '/stack-review/:id', {
  params: idParams,
  response: stackReviewSessionSchema,
})
export const retryStackReview = defineRoute('POST', '/stack-review/:id/retry', {
  params: idParams,
  response: stackReviewSessionSchema,
})
export const cancelStackReview = defineRoute('DELETE', '/stack-review/:id', {
  params: idParams,
  response: stackReviewSessionSchema,
})
