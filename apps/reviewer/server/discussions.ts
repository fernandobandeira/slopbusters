import { z } from 'zod'
import {
  DiffSide,
  type PullRequest,
  type PullDiscussions,
  type ReviewThread,
} from '../shared/types'
import { runCommand } from './process'

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
// GraphQL BigInt IDs arrive as decimal strings; keep their full precision for REST replies.
const commentIdSchema = z.string().regex(/^[1-9]\d*$/)
const commentsSchema = z.object({
  nodes: z.array(
    z.object({
      fullDatabaseId: commentIdSchema,
      body: z.string(),
      url: z.string(),
      createdAt: z.string(),
      author: z.object({ login: z.string() }).nullable(),
    }),
  ),
  pageInfo: pageInfoSchema,
})
const threadSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  diffSide: z.enum(DiffSide),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  viewerCanReply: z.boolean(),
  comments: commentsSchema,
})
const commentFields =
  'nodes { fullDatabaseId body url createdAt author { login } } pageInfo { hasNextPage endCursor }'
const query = `query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      headRefOid baseRefOid
      reviewThreads(first:100, after:$cursor) {
        nodes { id path line originalLine diffSide isResolved isOutdated viewerCanReply
          comments(first:100) { ${commentFields} }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

export async function fetchDiscussions(pr: PullRequest): Promise<PullDiscussions> {
  const threads: ReviewThread[] = []
  let cursor: string | null = null
  const threadCursors = new Set<string>()
  let revision: { headSha: string; baseSha: string } | undefined
  do {
    const result = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              headRefOid: z.string(),
              baseRefOid: z.string(),
              reviewThreads: z.object({ nodes: z.array(threadSchema), pageInfo: pageInfoSchema }),
            }),
          }),
        }),
      })
      .parse(await graphql(query, { owner: pr.owner, repo: pr.repo, number: pr.number, cursor }))
    const pull = result.data.repository.pullRequest
    if (revision && (revision.headSha !== pull.headRefOid || revision.baseSha !== pull.baseRefOid))
      throw new Error(
        'The PR changed while loading discussions. Reload to see their current locations.',
      )
    revision = { headSha: pull.headRefOid, baseSha: pull.baseRefOid }
    for (const thread of pull.reviewThreads.nodes) {
      let comments = thread.comments
      const entries = [...comments.nodes]
      const commentCursors = new Set<string>()
      while (comments.pageInfo.hasNextPage) {
        const commentCursor = nextCursor(comments.pageInfo, commentCursors)
        if (!commentCursor) throw new Error('GitHub returned an incomplete discussion.')
        const next = z
          .object({ data: z.object({ node: z.object({ comments: commentsSchema }) }) })
          .parse(
            await graphql(
              `query($id:ID!, $cursor:String!) {
            node(id:$id) { ... on PullRequestReviewThread {
              comments(first:100, after:$cursor) { ${commentFields} }
            } }
          }`,
              { id: thread.id, cursor: commentCursor },
            ),
          )
        comments = next.data.node.comments
        entries.push(...comments.nodes)
      }
      threads.push({
        id: thread.id,
        path: thread.path,
        line: thread.line,
        originalLine: thread.originalLine,
        side: thread.diffSide,
        resolved: thread.isResolved,
        outdated: thread.isOutdated,
        canReply: thread.viewerCanReply,
        comments: entries.map((comment) => ({
          id: comment.fullDatabaseId,
          author: comment.author?.login ?? 'deleted user',
          body: comment.body,
          url: comment.url,
          createdAt: comment.createdAt,
        })),
      })
    }
    cursor = nextCursor(pull.reviewThreads.pageInfo, threadCursors)
  } while (cursor)
  if (!revision) throw new Error('GitHub did not return this PR.')
  return { ...revision, threads }
}

export async function replyToThread(params: { pr: PullRequest; threadId: string; body: string }) {
  const body = params.body.trim()
  if (!body) throw new Error('Replies cannot be empty.')
  const discussions = await fetchDiscussions(params.pr)
  const thread = discussions.threads.find((thread) => thread.id === params.threadId)
  const parent = thread?.comments[0]
  if (!thread?.canReply || !parent) throw new Error('This discussion cannot receive a reply.')
  const output = await runCommand({
    command: 'gh',
    args: [
      'api',
      `repos/${params.pr.owner}/${params.pr.repo}/pulls/${params.pr.number}/comments/${parent.id}/replies`,
      '--method',
      'POST',
      '--input',
      '-',
    ],
    input: JSON.stringify({ body }),
  })
  return z.object({ html_url: z.string() }).parse(JSON.parse(output))
}

function nextCursor(page: z.infer<typeof pageInfoSchema>, seen: Set<string>): string | null {
  if (!page.hasNextPage) return null
  if (!page.endCursor || seen.has(page.endCursor))
    throw new Error('GitHub returned an incomplete discussion page.')
  seen.add(page.endCursor)
  return page.endCursor
}

async function graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const value: unknown = JSON.parse(
    await runCommand({
      command: 'gh',
      args: ['api', 'graphql', '--input', '-'],
      input: JSON.stringify({ query, variables }),
    }),
  )
  const errors = z
    .object({ errors: z.array(z.object({ message: z.string() })).optional() })
    .parse(value).errors
  if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '))
  return value
}
