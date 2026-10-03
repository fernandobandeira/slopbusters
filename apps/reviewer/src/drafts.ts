import { z } from 'zod'
import { DiffSide, type PullRequest, type ReviewDraft } from '../shared/types'
const schema = z.object({
  summary: z.string(),
  viewedFileIds: z.array(z.string()).optional(),
  viewedHunkIds: z.array(z.string()).optional(),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      groupTitle: z.string().optional(),
      headSha: z.string(),
      path: z.string().optional(),
      line: z.number().int().positive().optional(),
      side: z.enum(DiffSide).optional(),
      code: z.string().optional(),
    }),
  ),
})
export function draftKey(pr: PullRequest) {
  return `slopbusters:draft:${pr.owner}/${pr.repo}/${pr.number}:${pr.headSha}:${pr.baseSha}`
}
export function restoreDraft(pr: PullRequest, value: unknown): ReviewDraft {
  const stored = schema.parse(value)
  const comments: ReviewDraft['comments'] = []
  const summary = [stored.summary]
  for (const comment of stored.comments) {
    if (comment.path && comment.line != null && comment.side) {
      comments.push({
        id: comment.id,
        body: comment.body,
        headSha: comment.headSha,
        path: comment.path,
        line: comment.line,
        side: comment.side,
        code: comment.code,
      })
    } else {
      // Preserve earlier general notes in the review summary when restoring a draft.
      summary.push(`${comment.groupTitle ?? 'Review note'}\n\n${comment.body}`)
    }
  }
  const viewedHunks = new Set(stored.viewedHunkIds ?? [])
  const viewedFileIds =
    stored.viewedFileIds ??
    pr.files
      .filter(
        (file) => file.hunks.length > 0 && file.hunks.every((hunk) => viewedHunks.has(hunk.id)),
      )
      .map((file) => file.id)
  return { comments, summary: summary.filter(Boolean).join('\n\n'), viewedFileIds }
}
export function loadDraft(pr: PullRequest): ReviewDraft {
  try {
    const stored = localStorage.getItem(draftKey(pr))
    if (stored) return restoreDraft(pr, JSON.parse(stored))
  } catch {
    /* A damaged browser entry must not prevent reading the PR. */
  }
  return { comments: [], viewedFileIds: [], summary: '' }
}
