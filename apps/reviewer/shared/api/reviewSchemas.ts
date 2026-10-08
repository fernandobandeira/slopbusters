import { z } from 'zod'
import {
  DiffSide,
  LineKind,
  Priority,
  Provider,
  TransferKind,
  type PullRequest,
  type ReviewDraft,
  type PullDiscussions,
} from '../domain/types'

const line = z.object({
  id: z.string(),
  kind: z.enum(LineKind),
  text: z.string(),
  oldLine: z.number().nullable(),
  newLine: z.number().nullable(),
})
const hunk = z.object({
  sourceHunkId: z.string().optional(),
  id: z.string(),
  fileId: z.string(),
  header: z.string(),
  lines: z.array(line),
})
const file = z.object({
  id: z.string(),
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(hunk),
  coverage: z.enum(['complete', 'partial', 'unavailable']),
  oldContent: z.string().optional(),
  patch: z.string().optional(),
})
const group = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.enum(Priority),
  reason: z.string(),
  hunkIds: z.array(z.string()),
  fileIds: z.array(z.string()),
})
const transfer = z.object({
  id: z.string(),
  kind: z.enum(TransferKind),
  fromPath: z.string(),
  fromLine: z.number(),
  toPath: z.string(),
  toLine: z.number(),
  lineCount: z.number(),
  destinationLineIds: z.array(z.string()),
  sourceLineIds: z.array(z.string()),
  text: z.string(),
})
export const pullSchema = z.object({
  id: z.string(),
  url: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  baseBranch: z.string(),
  headBranch: z.string(),
  baseSha: z.string(),
  mergeBaseSha: z.string().optional(),
  headSha: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean().optional(),
  files: z.array(file),
  groups: z.array(group),
  transfers: z.array(transfer),
  groupingSource: z.union([z.literal('files'), z.enum(Provider)]),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<PullRequest>

const comment = z.object({
  id: z.string().max(100),
  body: z.string().min(1).max(10000),
  path: z.string().max(2000),
  line: z.number().int().positive(),
  side: z.enum(DiffSide),
  code: z.string().max(20000).optional(),
  headSha: z.string().max(100),
})
export const draftSchema = z.object({
  comments: z.array(comment).max(300),
  viewedFileIds: z.array(z.string().max(100)).max(10000),
  viewedHunkIds: z.array(z.string().max(100)).max(50000).optional(),
  summary: z.string().max(30000),
}) satisfies z.ZodType<ReviewDraft>
export const discussionsSchema = z.object({
  headSha: z.string(),
  baseSha: z.string(),
  threads: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      line: z.number().nullable(),
      originalLine: z.number().nullable(),
      side: z.enum(DiffSide),
      resolved: z.boolean(),
      outdated: z.boolean(),
      canReply: z.boolean(),
      comments: z.array(
        z.object({
          id: z.string(),
          author: z.string(),
          body: z.string(),
          url: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
}) satisfies z.ZodType<PullDiscussions>

export const reviewChangesSchema = z.object({
  baselineHeadSha: z.string(),
  baselineBaseSha: z.string(),
  incompletePaths: z.array(z.string()).optional(),
  sections: z.array(
    z.object({ hunkId: z.string(), state: z.enum(['new', 'changed', 'context-changed']) }),
  ),
  removed: z.array(z.object({ path: z.string(), line: z.number(), code: z.string() })),
})
