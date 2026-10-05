import { z } from 'zod'
import { bobAdviceSchema, bobReviewSummarySchema, type BobSession } from '../domain/bob'
import { organizationSchema } from '../domain/preferences'
import { defineRoute, idParams, repositoryQuery, pullUrlSchema } from './contract'
import { pullSchema } from './reviewSchemas'

const session = z.object({
  id: z.string(),
  repository: z.string(),
  urls: z.array(z.string()),
  primary: organizationSchema,
  companion: organizationSchema,
  status: z.enum(['running', 'partial', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  createdAt: z.string(),
  error: z.string().optional(),
  results: z.array(
    z.object({
      pull: pullSchema,
      fingerprint: z.string(),
      advice: bobAdviceSchema,
      reviewers: z.array(organizationSchema),
    }),
  ),
  pending: z
    .object({
      pull: pullSchema,
      fingerprint: z.string(),
      reviews: z.array(
        z.object({
          model: organizationSchema,
          advice: bobAdviceSchema.optional(),
          error: z.string().optional(),
        }),
      ),
    })
    .optional(),
}) satisfies z.ZodType<BobSession>

export const latestBob = defineRoute('GET', '/bob/latest', {
  query: repositoryQuery.extend({ url: pullUrlSchema.optional() }),
  response: z.object({ session: session.nullable() }),
})
export const savedBobReviews = defineRoute('GET', '/bob/reviews', {
  query: repositoryQuery,
  response: z.object({ reviews: z.array(bobReviewSummarySchema) }),
})
export const startBob = defineRoute('POST', '/bob', {
  request: repositoryQuery.extend({ urls: z.array(pullUrlSchema).min(1).max(20) }).strict(),
  response: session,
})
export const getBob = defineRoute('GET', '/bob/:id', { params: idParams, response: session })
export const continueBob = defineRoute('POST', '/bob/:id/continue', {
  params: idParams,
  response: session,
})
export const retryBob = defineRoute('POST', '/bob/:id/retry', {
  params: idParams,
  response: session,
})
export const cancelBob = defineRoute('DELETE', '/bob/:id', { params: idParams, response: session })
