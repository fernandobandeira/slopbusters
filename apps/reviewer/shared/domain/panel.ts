import { z } from 'zod'
import { findingCommentId, findingDraftComment, pointsAtChange } from './findings'
import { organizationSchema, type OrganizationPreferences } from './preferences'
import { teammateIdSchema } from './teammates'
import { DiffSide, Provider, type DraftComment, type PullRequest } from './types'

/** The reviewers Slopbusters ships; teammates join them as `teammate:<id>`. */
export const builtInReviewers = {
  unclebob: {
    name: 'Uncle Bob',
    description: 'Clean code: readability, structure, reuse, cognitive load and tests.',
    face: '/unclebob',
  },
  rules: {
    name: 'Rules',
    description: 'The repository’s written rules and the conventions its code applies.',
    face: undefined,
  },
} as const
export type BuiltInReviewer = keyof typeof builtInReviewers
export const builtInReviewerIds = Object.keys(builtInReviewers) as BuiltInReviewer[]

export const reviewerIdSchema = z.union([
  z.enum(builtInReviewerIds as [BuiltInReviewer, ...BuiltInReviewer[]]),
  z.templateLiteral(['teammate:', teammateIdSchema]),
])
export type ReviewerId = z.infer<typeof reviewerIdSchema>

export function teammateReviewerId(id: string): ReviewerId {
  return `teammate:${id}` as ReviewerId
}
/** The teammate behind a reviewer or seat id, such as `avery` for `teammate:avery@codex`. */
export function reviewerTeammate(id: string): string | undefined {
  const reviewer = seatReviewer(id)
  return reviewer.startsWith('teammate:') ? reviewer.slice('teammate:'.length) : undefined
}

/**
 * A seat is one reviewer on one provider. A reviewer asked on a single provider keeps its own id;
 * one asked on both gets a seat per provider, `<reviewer>@claude` and `<reviewer>@codex`, and the
 * judge weighs them as two reviewers.
 */
export const seatIdSchema = z
  .string()
  .max(80)
  .regex(/^(?:unclebob|rules|teammate:[a-z0-9]+(?:-[a-z0-9]+)*)(?:@(?:claude|codex))?$/)

export function seatReviewer(seat: string): string {
  return seat.replace(/@(?:claude|codex)$/, '')
}

/** Which reviewer to ask, and on which providers; without providers, the primary model's. */
export const panelSeatRequestSchema = z.union([
  reviewerIdSchema,
  z
    .object({
      id: reviewerIdSchema,
      providers: z.array(z.enum(Provider)).min(1).max(2).optional(),
    })
    .strict(),
])
export type PanelSeatRequest = z.infer<typeof panelSeatRequestSchema>

/** Ask the same seats again: each reviewer on the providers it ran on last time. */
export function seatRequests(
  reviewers: readonly PanelReviewer[],
  fallback: Provider,
): PanelSeatRequest[] {
  const providers = new Map<ReviewerId, Provider[]>()
  for (const seat of reviewers) {
    const id = seatReviewer(seat.id) as ReviewerId
    providers.set(id, [...(providers.get(id) ?? []), seat.model?.provider ?? fallback])
  }
  return [...providers].map(([id, list]) => ({ id, providers: list }))
}

/** A panel seat as the session saw it, so results still render after a teammate is removed. */
export const panelReviewerSchema = z.object({
  id: seatIdSchema,
  name: z.string(),
  description: z.string().optional(),
  /** The installed skill a teammate runs, by folder name. */
  skill: z.string().optional(),
  maxFindings: z.number().int().positive(),
  /** The model this seat reviews on; sessions saved before seats used the session's model. */
  model: organizationSchema.optional(),
})
export type PanelReviewer = z.infer<typeof panelReviewerSchema>

export const findingTags = ['convention', 'code', 'decision'] as const
export const findingTagLabels: Record<(typeof findingTags)[number], string> = {
  convention: 'Repository rule',
  code: 'Code',
  decision: 'Question for the author',
}
const severities = ['must-fix', 'should-fix', 'consider'] as const
export const panelSeverityLabels: Record<(typeof severities)[number], string> = {
  'must-fix': 'Must fix',
  'should-fix': 'Should fix',
  consider: 'Consider',
}
const verdicts = ['clean', 'changes', 'uncertain'] as const
export const panelVerdictLabels: Record<(typeof verdicts)[number], string> = {
  clean: 'Nothing to change',
  changes: 'Changes to make',
  uncertain: 'More context needed',
}

export const panelFindingSchema = z
  .object({
    id: z.string().min(1).max(80),
    severity: z.enum(severities),
    tag: z.enum(findingTags),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(3000),
    /** Required for convention and code findings; a decision is a question, not a fix. */
    suggestion: z.string().min(1).max(4000).optional(),
    path: z.string().min(1).max(1000),
    hunkId: z.string().min(1).max(200),
    line: z.number().int().positive(),
    side: z.enum(DiffSide),
  })
  .strict()
export type PanelFinding = z.infer<typeof panelFindingSchema>

/** One reviewer's review on the panel. */
export const panelAdviceSchema = z
  .object({
    verdict: z.enum(verdicts),
    summary: z.string().min(1).max(2000),
    findings: z.array(panelFindingSchema).max(40),
    good: z.array(z.string().min(1).max(1000)).max(8),
    limitations: z.array(z.string().min(1).max(1500)).max(12),
  })
  .strict()
export type PanelAdvice = z.infer<typeof panelAdviceSchema>

const raisedBy = z.array(z.string().min(1).max(60)).min(1).max(12)
export const judgedFindingSchema = panelFindingSchema.extend({ raisedBy }).strict()
export type JudgedFinding = z.infer<typeof judgedFindingSchema>

export const setAsideSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    path: z.string().max(1000).optional(),
    line: z.number().int().positive().optional(),
    raisedBy,
    reason: z.string().min(1).max(600),
  })
  .strict()
export type SetAside = z.infer<typeof setAsideSchema>

/** The judge's verdict over every review: verified findings with who raised them. */
export const judgeAdviceSchema = z
  .object({
    verdict: z.enum(verdicts),
    summary: z.string().min(1).max(2000),
    findings: z.array(judgedFindingSchema).max(60),
    setAside: z.array(setAsideSchema).max(60),
    good: z.array(z.string().min(1).max(1000)).max(8),
    limitations: z.array(z.string().min(1).max(1500)).max(16),
    disagreements: z.array(z.string().min(1).max(1500)).max(8),
  })
  .strict()
export type JudgeAdvice = z.infer<typeof judgeAdviceSchema>

/**
 * Keep a reviewer's findings that point at changed lines, at most `maxFindings` of them in
 * reading order, and a verdict that agrees with what is left.
 */
export function normalizePanelAdvice(
  pull: PullRequest,
  input: unknown,
  maxFindings: number,
): PanelAdvice {
  const advice = panelAdviceSchema.parse(input)
  const kept = rankFindings(usableFindings(pull, advice.findings, advice.limitations))
  if (kept.length > maxFindings)
    advice.limitations.push(
      `Kept the ${String(maxFindings)} highest-ranked of ${String(kept.length)} findings.`,
    )
  advice.findings = kept.slice(0, maxFindings)
  advice.verdict = agreeingVerdict(advice.verdict, advice.findings.length)
  return advice
}

/** The judge's advice, keeping only findings that point at changes and that a reviewer raised. */
export function normalizeJudgeAdvice(
  pull: PullRequest,
  input: unknown,
  reviewers: readonly string[],
): JudgeAdvice {
  const advice = judgeAdviceSchema.parse(input)
  const known = new Set(reviewers)
  const attributed = advice.findings
    .map((finding) => ({ ...finding, raisedBy: finding.raisedBy.filter((id) => known.has(id)) }))
    .filter((finding) => finding.raisedBy.length)
  if (attributed.length < advice.findings.length)
    advice.limitations.push(
      `Dropped ${String(advice.findings.length - attributed.length)} findings no reviewer on the panel raised.`,
    )
  advice.findings = rankFindings(usableFindings(pull, attributed, advice.limitations))
  advice.setAside = advice.setAside.map((item) => ({
    ...item,
    raisedBy: item.raisedBy.filter((id) => known.has(id)),
  }))
  advice.verdict = agreeingVerdict(advice.verdict, advice.findings.length)
  return advice
}

function usableFindings<F extends PanelFinding>(
  pull: PullRequest,
  findings: F[],
  limitations: string[],
): F[] {
  const ids = new Set<string>()
  const usable = findings.filter((finding) => {
    if (ids.has(finding.id) || !pointsAtChange(pull, finding)) return false
    ids.add(finding.id)
    return true
  })
  if (usable.length < findings.length)
    limitations.push(
      `Dropped ${String(findings.length - usable.length)} findings that did not point at a changed line of this snapshot or repeated an id.`,
    )
  return usable
}

/** Repository rules first, then what the code settles, then questions; severity within each. */
export function rankFindings<F extends Pick<PanelFinding, 'tag' | 'severity'>>(findings: F[]): F[] {
  const tag = { convention: 0, code: 1, decision: 2 }
  const severity = { 'must-fix': 0, 'should-fix': 1, consider: 2 }
  return [...findings].sort(
    (a, b) => tag[a.tag] - tag[b.tag] || severity[a.severity] - severity[b.severity],
  )
}

function agreeingVerdict(verdict: PanelAdvice['verdict'], findings: number) {
  if (findings) return verdict === 'clean' ? 'changes' : verdict
  return verdict === 'changes' ? 'uncertain' : verdict
}

export function panelCommentId(pull: PullRequest, finding: PanelFinding): string {
  return findingCommentId('panel', pull, finding)
}
export function panelDraftComment(
  pull: PullRequest,
  finding: PanelFinding,
  body: string,
): DraftComment {
  return findingDraftComment(panelCommentId(pull, finding), pull, finding, body)
}
/** The comment a finding starts as: a fix to make, or for a decision the question to answer. */
export function panelCommentBody(finding: PanelFinding): string {
  return [finding.title, finding.body, finding.tag === 'decision' ? '' : finding.suggestion]
    .filter(Boolean)
    .join('\n\n')
}

export interface PanelReview {
  /** The seat that wrote it. */
  reviewer: string
  advice?: PanelAdvice
  error?: string
}
export interface PanelPending {
  pull: PullRequest
  fingerprint: string
  context?: string
  reviews: PanelReview[]
}
export interface PanelResult {
  pull: PullRequest
  fingerprint: string
  advice: JudgeAdvice
  /** What each reviewer said before the judge, for a chat that continues one of them. */
  reviews: PanelReview[]
}
export interface PanelSession {
  id: string
  repository: string
  urls: string[]
  model: OrganizationPreferences
  reviewers: PanelReviewer[]
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
  progress: string
  results: PanelResult[]
  pending?: PanelPending
  error?: string
  createdAt: string
}

export const panelReviewSummarySchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  url: z.string(),
  number: z.number().int().positive(),
  headSha: z.string(),
  verdict: z.enum(verdicts),
  findingCount: z.number().int().nonnegative(),
  reviewers: z.array(z.string()),
})
export type PanelReviewSummary = z.infer<typeof panelReviewSummarySchema>
