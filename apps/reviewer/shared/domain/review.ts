import {
  DiffSide,
  LineKind,
  ReviewEvent,
  type ChangeGroup,
  type DraftComment,
  type PullRequest,
  type ReviewDraft,
} from './types'

export type ReviewLocation = Pick<DraftComment, 'path' | 'line' | 'side'>

/** Preserve any feedback edited while the submitted review was in flight. */
export function clearSubmittedFeedback(current: ReviewDraft, submitted: ReviewDraft): ReviewDraft {
  const published = new Map(
    submitted.comments.map((comment) => [comment.id, JSON.stringify(comment)]),
  )
  return {
    ...current,
    comments: current.comments.filter(
      (comment) => published.get(comment.id) !== JSON.stringify(comment),
    ),
    summary: current.summary === submitted.summary ? '' : current.summary,
  }
}

export function groupChangeTotals(
  pull: PullRequest,
  group: ChangeGroup,
): {
  additions: number
  deletions: number
} {
  const fileIds = new Set(group.fileIds)
  const hunkIds = new Set(group.hunkIds)
  const totals = { additions: 0, deletions: 0 }
  for (const file of pull.files) {
    if (!fileIds.has(file.id)) continue
    for (const hunk of file.hunks) {
      if (!hunkIds.has(hunk.id)) continue
      for (const line of hunk.lines) {
        if (line.kind === LineKind.added) totals.additions++
        else if (line.kind === LineKind.removed) totals.deletions++
      }
    }
  }
  return totals
}

export function exportFeedback(pr: PullRequest, draft: ReviewDraft): string {
  const sections = [
    `Review feedback for ${pr.owner}/${pr.repo}#${pr.number}: ${pr.title}`,
    pr.url,
    `Reviewed commit: ${pr.headSha}`,
    '',
    'Please address the feedback below against this commit. Check whether the branch has changed before editing.',
  ]
  if (draft.summary.trim()) sections.push('', draft.summary.trim())
  for (const [index, comment] of draft.comments.entries()) {
    const location = `${comment.path}:${comment.line} (${comment.side === DiffSide.left ? 'original' : 'updated'} code)`
    sections.push('', `${index + 1}. ${location}`, comment.body.trim())
    if (comment.code)
      sections.push('   Referenced code:', ...comment.code.split('\n').map((line) => `   ${line}`))
  }
  return sections.join('\n')
}

export function buildGitHubReview(pr: PullRequest, draft: ReviewDraft, event: ReviewEvent) {
  if (pr.state !== 'open') throw new Error('Only open pull requests can receive a review.')
  const inline: { path: string; line: number; side: DiffSide; body: string }[] = []
  for (const comment of draft.comments) {
    if (comment.headSha !== pr.headSha)
      throw new Error('Some comments belong to another revision. Revisit them before submitting.')
    if (!comment.body.trim()) throw new Error('Comments cannot be empty.')
    const file = pr.files.find((item) => item.path === comment.path)
    const valid = file?.hunks.some((hunk) =>
      hunk.lines.some((line) =>
        comment.side === DiffSide.left
          ? line.oldLine === comment.line
          : line.newLine === comment.line,
      ),
    )
    if (!valid) throw new Error(`The commented line in ${comment.path} is not in this diff.`)
    inline.push({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body.trim(),
    })
  }
  const body = draft.summary.trim()
  if (!body && inline.length === 0 && event !== ReviewEvent.approve)
    throw new Error('Add feedback before submitting this review.')
  return {
    commit_id: pr.headSha,
    event,
    body: body || (event === ReviewEvent.approve ? '' : 'Please see the inline review comments.'),
    comments: inline,
  }
}
