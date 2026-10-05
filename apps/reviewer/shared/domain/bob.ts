import { z } from 'zod'
import { DiffSide, LineKind, type DraftComment, type PullRequest } from './types'
import type { ReviewResult, ReviewSession, PendingReview } from './reviewSession'

export const bobAdviceSchema = z
  .object({
    verdict: z.enum(['clean', 'changes', 'uncertain']),
    summary: z.string().min(1).max(2000),
    findings: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            severity: z.enum(['must-fix', 'should-fix', 'consider']),
            title: z.string().min(1).max(200),
            body: z.string().min(1).max(2000),
            suggestion: z.string().min(1).max(4000),
            path: z.string().min(1).max(1000),
            hunkId: z.string().min(1).max(200),
            line: z.number().int().positive(),
            side: z.enum(DiffSide),
          })
          .strict(),
      )
      .max(20),
    good: z.array(z.string().min(1).max(1000)).max(8),
    limitations: z.array(z.string().min(1).max(1500)).max(12),
    disagreements: z.array(z.string().min(1).max(1500)).max(8),
  })
  .strict()
export type BobAdvice = z.infer<typeof bobAdviceSchema>
export type BobFinding = BobAdvice['findings'][number]
export type BobResult = ReviewResult<BobAdvice>
export type BobSession = ReviewSession<BobAdvice>
export type BobPending = PendingReview<BobAdvice>

export const bobVerdictLabels: Record<BobAdvice['verdict'], string> = {
  clean: 'Code reads well',
  changes: 'Improvements to make',
  uncertain: 'More context needed',
}
export const bobSeverityLabels: Record<BobFinding['severity'], string> = {
  'must-fix': 'Must fix',
  'should-fix': 'Should fix',
  consider: 'Consider',
}

export function validateBobAdvice(pull: PullRequest, input: unknown): BobAdvice {
  const advice = bobAdviceSchema.parse(input)
  const ids = new Set<string>()
  for (const finding of advice.findings) {
    if (ids.has(finding.id)) throw new Error('Each Bob finding must have a unique ID.')
    ids.add(finding.id)
    const hunk = pull.files
      .find((file) => file.path === finding.path)
      ?.hunks.find((hunk) => hunk.id === finding.hunkId)
    const line = hunk?.lines.find((line) =>
      finding.side === DiffSide.left
        ? line.oldLine === finding.line
        : line.newLine === finding.line,
    )
    if (!line || line.kind === LineKind.context)
      throw new Error('A Bob finding must reference a changed line in this PR snapshot.')
  }
  if (advice.verdict === 'clean' && advice.findings.length)
    throw new Error('A clean review cannot contain findings.')
  if (advice.verdict === 'changes' && !advice.findings.length)
    throw new Error('A changes verdict needs at least one finding.')
  const rank = { 'must-fix': 0, 'should-fix': 1, consider: 2 }
  advice.findings.sort((a, b) => rank[a.severity] - rank[b.severity])
  return advice
}

export function bobCommentId(pull: PullRequest, finding: BobFinding): string {
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
  return `bob:${hash.toString(16)}`
}
export function bobDraftComment(
  pull: PullRequest,
  finding: BobFinding,
  body: string,
): DraftComment {
  const hunk = pull.files
    .find((file) => file.path === finding.path)
    ?.hunks.find((hunk) => hunk.id === finding.hunkId)
  const line = hunk?.lines.find((line) =>
    finding.side === DiffSide.left ? line.oldLine === finding.line : line.newLine === finding.line,
  )
  if (!line) throw new Error('This finding no longer belongs to the review snapshot.')
  return {
    id: bobCommentId(pull, finding),
    body: body.trim(),
    path: finding.path,
    line: finding.line,
    side: finding.side,
    headSha: pull.headSha,
    code: line.text.slice(0, 20000),
  }
}

export function bobSnapshotMatches(current: PullRequest, saved: PullRequest): boolean {
  return (
    current.url === saved.url &&
    current.headSha === saved.headSha &&
    current.baseSha === saved.baseSha &&
    current.title === saved.title &&
    current.description === saved.description
  )
}
