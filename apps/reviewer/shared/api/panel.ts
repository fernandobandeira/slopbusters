import { z } from 'zod'
import {
  judgeAdviceSchema,
  panelAdviceSchema,
  panelFindingSchema,
  panelReviewerSchema,
  panelReviewSummarySchema,
  panelSeatRequestSchema,
  seatIdSchema,
} from '../domain/panel'
import { groundingStateSchema } from '../domain/grounding'
import { gateSchema } from '../domain/panelGate'
import type { PanelSession } from '../domain/panelSession'
import { organizationSchema } from '../domain/preferences'
import { defineRoute, idParams, pullUrlSchema, repositoryQuery } from './contract'
import { pullSchema } from './reviewSchemas'

const review = z.object({
  reviewer: seatIdSchema,
  advice: panelAdviceSchema.optional(),
  unplaced: z.array(z.object({ finding: panelFindingSchema, problem: z.string() })).optional(),
  capped: z.boolean().optional(),
  skillDigest: z.string().optional(),
  error: z.string().optional(),
})

const session = z.object({
  id: z.string(),
  repository: z.string(),
  urls: z.array(z.string()),
  model: organizationSchema,
  companion: organizationSchema.optional(),
  judges: z
    .object({ primary: organizationSchema, companion: organizationSchema.optional() })
    .optional(),
  reviewers: z.array(panelReviewerSchema),
  status: z.enum(['running', 'partial', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  createdAt: z.string(),
  error: z.string().optional(),
  results: z.array(
    z.object({
      pull: pullSchema,
      fingerprint: z.string(),
      advice: judgeAdviceSchema,
      reviews: z.array(review),
      grounding: groundingStateSchema.optional(),
      gate: gateSchema.optional(),
    }),
  ),
  pending: z
    .object({
      pull: pullSchema,
      fingerprint: z.string(),
      context: z.string().optional(),
      reviews: z.array(review),
      grounding: groundingStateSchema.optional(),
    })
    .optional(),
}) satisfies z.ZodType<PanelSession>

export const latestPanel = defineRoute('GET', '/panel/latest', {
  query: repositoryQuery.extend({ url: pullUrlSchema.optional() }),
  response: z.object({ session: session.nullable() }),
})
export const savedPanelReviews = defineRoute('GET', '/panel/reviews', {
  query: repositoryQuery,
  response: z.object({ reviews: z.array(panelReviewSummarySchema) }),
})
export const startPanel = defineRoute('POST', '/panel', {
  request: repositoryQuery
    .extend({
      urls: z.array(pullUrlSchema).min(1).max(20),
      reviewers: z.array(panelSeatRequestSchema).min(1).max(8),
    })
    .strict(),
  response: session,
})
export const getPanel = defineRoute('GET', '/panel/:id', { params: idParams, response: session })
export const continuePanel = defineRoute('POST', '/panel/:id/continue', {
  params: idParams,
  response: session,
})
export const retryPanel = defineRoute('POST', '/panel/:id/retry', {
  params: idParams,
  response: session,
})
/** Save what the author chose to fix on one reviewed PR. */
export const savePanelGate = defineRoute('PUT', '/panel/:id/gate', {
  params: idParams,
  request: z.object({ url: pullUrlSchema, gate: gateSchema }).strict(),
  response: session,
})
/** Ask the grounding models for a plan for one entry, from the author's answer if it has one. */
export const planPanelFix = defineRoute('POST', '/panel/:id/plan', {
  params: idParams,
  request: z.object({ url: pullUrlSchema, entry: z.string().min(1).max(40) }).strict(),
  response: session,
})
export const cancelPanel = defineRoute('DELETE', '/panel/:id', {
  params: idParams,
  response: session,
})
