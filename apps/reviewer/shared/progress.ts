import { createHash } from 'node:crypto'
import type { ChangedFile, Hunk, PullRequest, ReviewDraft } from './types'

/** Line positions and generated IDs are absent: only reviewed content matters. */
export function hunkFingerprint(file: ChangedFile, hunk: Hunk): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        file.path,
        file.previousPath ?? null,
        file.status,
        hunk.lines.map((line) => [line.kind, line.text]),
      ]),
    )
    .digest('hex')
}
export function pullIdentity(pull: PullRequest): string {
  return `${pull.owner.toLowerCase()}/${pull.repo.toLowerCase()}/${pull.number}`
}
export function emptyDraft(): ReviewDraft {
  return { comments: [], viewedFileIds: [], viewedHunkIds: [], summary: '' }
}
export function restoreProgress(
  pull: PullRequest,
  draft: ReviewDraft,
  reviewed: ReadonlySet<string>,
): ReviewDraft {
  const counts = fingerprintCounts(pull)
  const sameRevisionFiles = new Set(draft.viewedFileIds)
  const sameRevisionHunks = new Set(draft.viewedHunkIds ?? [])
  const viewedHunkIds: string[] = []
  const viewedFileIds: string[] = []
  for (const file of pull.files) {
    const viewed = file.hunks.filter((hunk) =>
      file.coverage === 'complete' && counts.get(hunkFingerprint(file, hunk)) === 1
        ? reviewed.has(hunkFingerprint(file, hunk))
        : sameRevisionFiles.has(file.id) || sameRevisionHunks.has(hunk.id),
    )
    viewedHunkIds.push(...viewed.map((hunk) => hunk.id))
    if (
      (file.hunks.length > 0 && viewed.length === file.hunks.length) ||
      (file.hunks.length === 0 && sameRevisionFiles.has(file.id))
    )
      viewedFileIds.push(file.id)
  }
  return { ...draft, viewedFileIds, viewedHunkIds }
}
export function reviewedFingerprints(pull: PullRequest, draft: ReviewDraft): Set<string> {
  const counts = fingerprintCounts(pull)
  const viewedFiles = new Set(draft.viewedFileIds)
  const viewedHunks = new Set(draft.viewedHunkIds ?? [])
  return new Set(
    pull.files
      .filter((file) => file.coverage === 'complete')
      .flatMap((file) =>
        file.hunks
          .filter(
            (hunk) =>
              counts.get(hunkFingerprint(file, hunk)) === 1 &&
              (viewedFiles.has(file.id) || viewedHunks.has(hunk.id)),
          )
          .map((hunk) => hunkFingerprint(file, hunk)),
      ),
  )
}

// Identical content at several locations has no trustworthy identity after a revision change.
function fingerprintCounts(pull: PullRequest): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of pull.files)
    for (const hunk of file.hunks) {
      const fingerprint = hunkFingerprint(file, hunk)
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
    }
  return counts
}
