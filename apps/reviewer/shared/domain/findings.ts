import { DiffSide, LineKind, type DiffLine, type DraftComment, type PullRequest } from './types'

/** Where a reviewer's finding points: a line of one hunk, on one side of the diff. */
export interface FindingLocation {
  id: string
  path: string
  hunkId: string
  line: number
  side: DiffSide
}

/** The diff line a finding points at, or undefined when it is not in this snapshot. */
export function findingLine(pull: PullRequest, finding: FindingLocation): DiffLine | undefined {
  const hunk = pull.files
    .find((file) => file.path === finding.path)
    ?.hunks.find((hunk) => hunk.id === finding.hunkId)
  return hunk?.lines.find((line) =>
    finding.side === DiffSide.left ? line.oldLine === finding.line : line.newLine === finding.line,
  )
}

/** Findings must point at a line the PR changed, not at context around it. */
export function pointsAtChange(pull: PullRequest, finding: FindingLocation): boolean {
  const line = findingLine(pull, finding)
  return Boolean(line && line.kind !== LineKind.context)
}

/**
 * A stable draft comment id for a finding at this PR revision, so saving the same finding twice
 * replaces the comment instead of adding another.
 */
export function findingCommentId(prefix: string, pull: PullRequest, finding: FindingLocation) {
  const source = JSON.stringify([
    pull.url,
    pull.headSha,
    pull.baseSha,
    finding.id,
    finding.path,
    finding.hunkId,
    finding.line,
    finding.side,
  ])
  // FNV-1a keeps the stable annotation ID below the draft contract's 100-character limit.
  let hash = 14695981039346656037n
  for (const byte of new TextEncoder().encode(source))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n)
  return `${prefix}:${hash.toString(16)}`
}

export function findingDraftComment(
  id: string,
  pull: PullRequest,
  finding: FindingLocation,
  body: string,
): DraftComment {
  const line = findingLine(pull, finding)
  if (!line) throw new Error('This finding no longer belongs to the review snapshot.')
  return {
    id,
    body: body.trim(),
    path: finding.path,
    line: finding.line,
    side: finding.side,
    headSha: pull.headSha,
    code: line.text.slice(0, 20000),
  }
}

/** Whether a saved review still describes the PR as it is now. */
export function snapshotMatches(current: PullRequest, saved: PullRequest): boolean {
  return (
    current.url === saved.url &&
    current.headSha === saved.headSha &&
    current.baseSha === saved.baseSha &&
    current.title === saved.title &&
    current.description === saved.description
  )
}
