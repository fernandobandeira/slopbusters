import { createHash } from 'node:crypto'
import type { PullRequest } from '../shared/domain/types'
import { transferEvidence, transferLines } from './features/transferPrompt'

export function pullFingerprint(pull: PullRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        url: pull.url,
        head: pull.headSha,
        base: pull.baseSha,
        title: pull.title,
        description: pull.description,
        files: pull.files,
      }),
    )
    .digest('hex')
}

/** The PR as a model pass reads it; moved and copied blocks are marked as `transferInstructions` explains. */
export function reviewEvidence(pull: PullRequest): string {
  const lines = transferLines(pull)
  return JSON.stringify({
    url: pull.url,
    title: pull.title,
    description: pull.description,
    headSha: pull.headSha,
    baseSha: pull.baseSha,
    baseBranch: pull.baseBranch,
    files: pull.files.map((file) => ({
      path: file.path,
      status: file.status,
      coverage: file.coverage,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.hunks.map((hunk) => ({
        id: hunk.id,
        header: hunk.header,
        lines: lines(hunk),
      })),
    })),
    ...(pull.transfers.length ? { transfers: transferEvidence(pull) } : {}),
    warnings: pull.warnings,
  })
}
