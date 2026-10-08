import { z } from 'zod'
import { ReviewEvent } from '../domain/types'
import {
  defineRoute,
  idParams,
  okSchema,
  repositoryQuery,
  urlQuery,
  pullUrlSchema,
} from './contract'
import { draftSchema, pullSchema, discussionsSchema, reviewChangesSchema } from './reviewSchemas'
import {
  appStatusSchema,
  inboxSchema,
  pullStatusSchema,
  repositorySchema,
  stackSchema,
} from './statusSchemas'

export const getStatus = defineRoute('GET', '/status', { response: appStatusSchema })
export const getRepositories = defineRoute('GET', '/repositories', {
  response: z.object({ viewer: z.string(), repositories: z.array(repositorySchema) }),
})
export const getInbox = defineRoute('GET', '/inbox', {
  query: repositoryQuery,
  response: inboxSchema,
})
export const getInboxStatus = defineRoute('GET', '/inbox-status', {
  query: repositoryQuery.extend({
    filter: z.enum(['all', 'mine']).default('all'),
    refresh: z.enum(['0', '1']).optional(),
  }),
  response: z.object({
    statuses: z.array(z.object({ number: z.number(), status: pullStatusSchema })),
    warnings: z.array(z.string()),
  }),
})
export const loadPull = defineRoute('POST', '/pulls', {
  request: z.object({ url: pullUrlSchema }),
  response: pullSchema,
})
export const getPull = defineRoute('GET', '/pulls/:id', { params: idParams, response: pullSchema })
export const getPullStatus = defineRoute('GET', '/pulls/:id/status', {
  params: idParams,
  response: pullStatusSchema,
})
export const getStatusByUrl = defineRoute('GET', '/pull-status', {
  query: urlQuery,
  response: pullStatusSchema,
})
export const getPullStack = defineRoute('GET', '/pulls/:id/stack', {
  params: idParams,
  response: stackSchema,
})
export const getStackByUrl = defineRoute('GET', '/stack', {
  query: urlQuery.extend({ refresh: z.enum(['0', '1']).optional() }),
  response: stackSchema,
})
export const getPullRevision = defineRoute('GET', '/pulls/:id/revision', {
  params: idParams,
  response: z.object({
    headSha: z.string(),
    baseSha: z.string(),
    state: z.enum(['open', 'closed', 'merged']),
  }),
})
export const getDraft = defineRoute('GET', '/pulls/:id/draft', {
  params: idParams,
  response: z.object({
    draft: draftSchema,
    exists: z.boolean(),
    changes: reviewChangesSchema.optional(),
  }),
})
/** Forget the previous review baseline, so this revision no longer reports updates. */
export const dismissReviewChanges = defineRoute('DELETE', '/pulls/:id/changes', {
  params: idParams,
  response: okSchema,
})
export const saveDraft = defineRoute('PUT', '/pulls/:id/draft', {
  params: idParams,
  request: draftSchema,
  response: getDraft.response,
})
export const getThreads = defineRoute('GET', '/pulls/:id/threads', {
  params: idParams,
  response: discussionsSchema,
})
export const replyToThread = defineRoute('POST', '/pulls/:id/threads/:threadId/replies', {
  params: idParams.extend({ threadId: z.string().min(1).max(300) }),
  request: z.object({ body: z.string().trim().min(1).max(10000) }),
  response: z.object({ html_url: z.string() }),
})
export const organizePull = defineRoute('POST', '/pulls/:id/organize', {
  params: idParams,
  request: z.object({ force: z.boolean().default(false) }).strict(),
  response: z.union([
    z.object({ id: z.string(), complete: z.undefined().optional() }),
    z.object({ complete: z.literal(true), id: z.undefined().optional() }),
  ]),
})
export const getJob = defineRoute('GET', '/jobs/:id', {
  params: idParams,
  response: z.object({
    status: z.enum(['running', 'complete', 'failed']),
    error: z.string().optional(),
    pullId: z.string(),
  }),
})
export const cancelJob = defineRoute('DELETE', '/jobs/:id', {
  params: idParams,
  response: okSchema,
})
export const submitReview = defineRoute('POST', '/pulls/:id/reviews', {
  params: idParams,
  request: z.object({ draft: draftSchema, event: z.enum(ReviewEvent) }),
  response: z.object({ url: z.string(), id: z.number() }),
})
export const markPullReady = defineRoute('POST', '/pulls/:id/ready', {
  params: idParams,
  response: pullSchema,
})
