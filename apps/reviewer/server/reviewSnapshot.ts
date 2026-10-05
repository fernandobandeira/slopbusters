import { MAX_REVIEW_SNAPSHOT_CHARACTERS } from './limits'
import { createHash } from 'node:crypto'
import type { PullRequest } from '../shared/domain/types'

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

export function reviewEvidence(pull: PullRequest, reviewer = 'Linus'): string {
  const data = JSON.stringify({
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
        lines: hunk.lines.map(({ kind, text, oldLine, newLine }) => ({
          kind,
          text,
          oldLine,
          newLine,
        })),
      })),
    })),
    warnings: pull.warnings,
  })
  if (data.length > MAX_REVIEW_SNAPSHOT_CHARACTERS)
    throw new Error(
      `This PR exceeds ${reviewer}’s review limit. Review a smaller PR or inspect the full diff manually.`,
    )
  return data
}
