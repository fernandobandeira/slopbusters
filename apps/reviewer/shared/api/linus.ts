import { z } from 'zod'
import { adviceSchema, verdictSchema, type LinusSession } from '../domain/linus'
import { panelSeatRequestSchema } from '../domain/panel'
import { organizationSchema } from '../domain/preferences'
import { defineRoute, idParams, repositoryQuery, pullUrlSchema } from './contract'
import { pullSchema } from './reviewSchemas'

const thenPanel = z.object({ reviewers: z.array(panelSeatRequestSchema).min(1).max(8) }).strict()
const guidance = z.string().trim().min(1).max(4000)
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
  thenPanel: thenPanel.optional(),
  guidance: z.string().optional(),
  results: z.array(
    z.object({
      pull: pullSchema,
      fingerprint: z.string(),
      advice: adviceSchema,
      reviewers: z.array(organizationSchema),
      panelSessionId: z.string().optional(),
      panelError: z.string().optional(),
    }),
  ),
  pending: z
    .object({
      pull: pullSchema,
      fingerprint: z.string(),
      reviews: z.array(
        z.object({
          model: organizationSchema,
          advice: adviceSchema.optional(),
          error: z.string().optional(),
        }),
      ),
    })
    .optional(),
}) satisfies z.ZodType<LinusSession>
export const latestLinus = defineRoute('GET', '/linus/latest', {
  query: repositoryQuery,
  response: z.object({ session: session.nullable() }),
})
export const linusRecommendations = defineRoute('GET', '/linus/recommendations', {
  query: repositoryQuery,
  response: z.object({
    recommendations: z.array(
      z.object({
        sessionId: z.string(),
        createdAt: z.string(),
        url: z.string(),
        number: z.number(),
        headSha: z.string(),
        verdict: verdictSchema,
        recommendationCount: z.number(),
        panel: z.enum(['started', 'waiting']).optional(),
      }),
    ),
  }),
})
export const startLinus = defineRoute('POST', '/linus', {
  request: repositoryQuery
    .extend({
      urls: z.array(pullUrlSchema).min(1).max(20),
      /** Start this panel on each PR Linus would keep as one; the others wait for the author. */
      thenPanel: thenPanel.optional(),
      /** What the author wants Linus to weigh, when asking again. */
      guidance: guidance.optional(),
    })
    .strict(),
  response: session,
})
export const getLinus = defineRoute('GET', '/linus/:id', { params: idParams, response: session })
/** Start the panel that was to follow Linus on a PR he would split, as the author decided. */
export const startLinusPanel = defineRoute('POST', '/linus/:id/panel', {
  params: idParams,
  request: z.object({ url: pullUrlSchema }).strict(),
  response: session,
})
export const continueLinus = defineRoute('POST', '/linus/:id/continue', {
  params: idParams,
  response: session,
})
export const retryLinus = defineRoute('POST', '/linus/:id/retry', {
  params: idParams,
  response: session,
})
export const cancelLinus = defineRoute('DELETE', '/linus/:id', {
  params: idParams,
  response: session,
})
