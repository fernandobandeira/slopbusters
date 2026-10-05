import { z } from 'zod'
import type { PullStatus } from '../domain/pullStatus'
import type { PullStackResult } from '../domain/stacks'
import type { AppStatus, RepositoryInbox } from '../domain/types'

export const pullStatusSchema = z.object({
  detailLevel: z.enum(['summary', 'full']).optional(),
  unresolvedReviewThreads: z.number().nullable().optional(),
  unresolvedThreads: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        line: z.number().nullable(),
        originalLine: z.number().nullable(),
        outdated: z.boolean(),
        url: z.string().optional(),
        author: z.string().optional(),
        body: z.string(),
      }),
    )
    .optional(),
  headSha: z.string(),
  baseSha: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  readiness: z.enum(['ready', 'not-ready', 'checking', 'unknown', 'merged', 'closed']),
  reasons: z.array(z.string()),
  mergeState: z.string(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  requiredApprovals: z.number().nullable(),
  requiresCodeOwnerReviews: z.boolean().nullable(),
  requirementsKnown: z.boolean(),
  checksState: z.string().nullable(),
  checks: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['check', 'status']),
      status: z.enum(['queued', 'in-progress', 'completed']),
      conclusion: z.string().nullable(),
      url: z.string().optional(),
      required: z.boolean().optional(),
    }),
  ),
  reviewers: z.array(
    z.object({
      login: z.string(),
      type: z.enum(['user', 'team']),
      avatarUrl: z.string().optional(),
      url: z.string().optional(),
      state: z.enum([
        'requested',
        'approved',
        'changes-requested',
        'commented',
        'dismissed',
        'pending',
      ]),
    }),
  ),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<PullStatus>
export const stackSummarySchema = z.object({
  id: z.string(),
  number: z.number().optional(),
  source: z.enum(['github', 'derived']),
  baseBranch: z.string(),
  position: z.number(),
  size: z.number(),
})
export const stackSchema = z.object({
  summary: stackSummarySchema.optional(),
  warnings: z.array(z.string()),
  stack: stackSummarySchema
    .extend({
      warnings: z.array(z.string()),
      items: z.array(
        z.object({
          status: pullStatusSchema.optional(),
          number: z.number(),
          title: z.string(),
          url: z.string(),
          repository: z.string(),
          headBranch: z.string(),
          baseBranch: z.string(),
          state: z.enum(['open', 'closed', 'merged']),
          isDraft: z.boolean(),
        }),
      ),
    })
    .nullable(),
}) satisfies z.ZodType<PullStackResult>
const tool = z.object({
  available: z.boolean(),
  detail: z.string(),
  authenticated: z.boolean().optional(),
})
export const appStatusSchema = z.object({
  github: tool.extend({
    profile: z.object({ login: z.string(), avatarUrl: z.string(), url: z.string() }).optional(),
  }),
  codex: tool,
  claude: tool,
}) satisfies z.ZodType<AppStatus>
export const repositorySchema = z.object({
  fullName: z.string(),
  description: z.string(),
  private: z.boolean(),
})
export const inboxSchema = z.object({
  viewer: z.string(),
  warnings: z.array(z.string()).optional(),
  pulls: z.array(
    z.object({
      status: pullStatusSchema.optional(),
      stack: stackSummarySchema.optional(),
      number: z.number(),
      url: z.string(),
      title: z.string(),
      author: z.string(),
      updatedAt: z.string(),
      isDraft: z.boolean(),
      headSha: z.string(),
      labels: z.array(z.string()),
      reviewRequested: z.boolean(),
    }),
  ),
}) satisfies z.ZodType<RepositoryInbox>
