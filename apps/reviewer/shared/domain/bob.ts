import { z } from 'zod'
import { DiffSide, type DraftComment, type PullRequest } from './types'
import { findingCommentId, findingDraftComment, pointsAtChange, snapshotMatches } from './findings'
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

export const bobReviewSummarySchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  url: z.string(),
  number: z.number().int().positive(),
  headSha: z.string(),
  verdict: bobAdviceSchema.shape.verdict,
  findingCount: z.number().int().nonnegative(),
})
export type BobReviewSummary = z.infer<typeof bobReviewSummarySchema>

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

export function bobFindingMarkdown(finding: BobFinding): string {
  const side = finding.side === DiffSide.left ? 'original' : 'updated'
  return [
    `**${bobSeverityLabels[finding.severity]}: ${finding.title}**`,
    `\`${finding.path}:${finding.line}\` · ${side} code`,
    finding.body,
    `**Suggested improvement**\n\n${finding.suggestion}`,
  ].join('\n\n')
}

/** Uncle Bob's whole review as Markdown, for the clipboard and for a chat that continues it. */
export function bobReviewMarkdown(advice: BobAdvice): string {
  const notes = [
    ['What reads well', advice.good],
    ['Review limitations', advice.limitations],
    ['Unresolved disagreements', advice.disagreements],
  ] as const
  return [
    `## Uncle Bob: ${bobVerdictLabels[advice.verdict]}\n\n${advice.summary}`,
    ...advice.findings.map(bobFindingMarkdown),
    ...notes
      .filter(([, entries]) => entries.length)
      .map(([title, entries]) => `**${title}**\n\n${entries.map((e) => `- ${e}`).join('\n')}`),
  ].join('\n\n---\n\n')
}

export function validateBobAdvice(pull: PullRequest, input: unknown): BobAdvice {
  const advice = bobAdviceSchema.parse(input)
  const ids = new Set<string>()
  for (const finding of advice.findings) {
    if (ids.has(finding.id)) throw new Error('Each Bob finding must have a unique ID.')
    ids.add(finding.id)
    if (!pointsAtChange(pull, finding))
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
  return findingCommentId('bob', pull, finding)
}
export function bobDraftComment(
  pull: PullRequest,
  finding: BobFinding,
  body: string,
): DraftComment {
  return findingDraftComment(bobCommentId(pull, finding), pull, finding, body)
}

export const bobSnapshotMatches = snapshotMatches
