import { z } from 'zod'
import { jobsAnswerSchema, jobsReviewSummarySchema, jobsSessionSchema } from '../domain/jobs'
import { ticketIdentifierSchema } from '../domain/tickets'
import { defineRoute, idParams } from './contract'

export const jobsReviews = defineRoute('GET', '/ticket-reviews/summaries', {
  response: z.object({ reviews: z.array(jobsReviewSummarySchema) }),
})
export const latestJobs = defineRoute('GET', '/ticket-reviews/latest', {
  query: z.object({ ticket: ticketIdentifierSchema }).strict(),
  response: z.object({ session: jobsSessionSchema.nullable() }),
})
export const startJobs = defineRoute('POST', '/ticket-reviews', {
  request: z
    .object({
      ticket: ticketIdentifierSchema,
      repository: z
        .string()
        .max(300)
        .regex(/^([\w.-]+\/[\w.-]+)?$/),
    })
    .strict(),
  response: jobsSessionSchema,
})
export const getJobs = defineRoute('GET', '/ticket-reviews/:id', {
  params: idParams,
  response: jobsSessionSchema,
})
export const answerJobs = defineRoute('POST', '/ticket-reviews/:id/answers', {
  params: idParams,
  request: z.object({ answers: z.array(jobsAnswerSchema).min(1).max(20) }).strict(),
  response: jobsSessionSchema,
})
export const applyJobs = defineRoute('POST', '/ticket-reviews/:id/apply', {
  params: idParams,
  request: z
    .object({
      title: z.string().trim().min(1).max(255),
      description: z.string().min(1).max(60000),
    })
    .strict(),
  response: jobsSessionSchema,
})
export const continueJobs = defineRoute('POST', '/ticket-reviews/:id/continue', {
  params: idParams,
  response: jobsSessionSchema,
})
export const retryJobs = defineRoute('POST', '/ticket-reviews/:id/retry', {
  params: idParams,
  response: jobsSessionSchema,
})
export const cancelJobs = defineRoute('DELETE', '/ticket-reviews/:id', {
  params: idParams,
  response: jobsSessionSchema,
})
