import { z } from 'zod'
import { organizationSchema } from './preferences'

export const jobsRuleSchema = z.enum([
  'job',
  'first-screen',
  'done-means',
  'scope',
  'decisions',
  'questions',
  'collapses',
  'sources',
  'history',
  'language',
  'family',
  'alignment',
  'code',
])
export const jobsAdviceSchema = z
  .object({
    verdict: z.enum(['ready', 'needs-work', 'uncertain']),
    summary: z.string().min(1).max(2000),
    findings: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            rule: jobsRuleSchema,
            severity: z.enum(['blocking', 'important', 'polish']),
            title: z.string().min(1).max(200),
            body: z.string().min(1).max(2000),
            reference: z.string().max(2000),
          })
          .strict(),
      )
      .max(20),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            topic: z.string().min(1).max(120),
            question: z.string().min(1).max(1000),
            owner: z.string().min(1).max(200),
            blocks: z.string().min(1).max(1000),
            options: z.array(z.string().min(1).max(300)).max(4),
          })
          .strict(),
      )
      .max(20),
    resolved: z.array(z.string().min(1).max(80)).max(20),
    revisedTitle: z.string().max(255),
    revisedDescription: z.string().min(1).max(60000),
    unverified: z.array(z.string().min(1).max(1500)).max(12),
    limitations: z.array(z.string().min(1).max(1500)).max(12),
    disagreements: z.array(z.string().min(1).max(1500)).max(8),
  })
  .strict()
export type JobsAdvice = z.infer<typeof jobsAdviceSchema>
export type JobsFinding = JobsAdvice['findings'][number]
export type JobsQuestion = JobsAdvice['questions'][number]

export const jobsAnswerSchema = z
  .object({
    questionId: z.string().min(1).max(80),
    question: z.string().min(1).max(1000),
    answer: z.string().trim().min(1).max(4000),
  })
  .strict()
export type JobsAnswer = z.infer<typeof jobsAnswerSchema>

export const jobsSnapshotSchema = z.object({
  identifier: z.string(),
  id: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  updatedAt: z.string(),
})

const reviewKind = z.enum(['review', 'answers'])
export const jobsSessionSchema = z.object({
  id: z.string(),
  ticket: z.string(),
  repository: z.string(),
  primary: organizationSchema,
  companion: organizationSchema,
  status: z.enum(['running', 'partial', 'complete', 'failed', 'cancelled']),
  progress: z.string(),
  createdAt: z.string(),
  error: z.string().optional(),
  snapshot: jobsSnapshotSchema.optional(),
  revisions: z.array(
    z.object({
      kind: reviewKind,
      advice: jobsAdviceSchema,
      reviewers: z.array(organizationSchema),
      answers: z.array(jobsAnswerSchema),
      createdAt: z.string(),
    }),
  ),
  pending: z
    .object({
      kind: reviewKind,
      answers: z.array(jobsAnswerSchema),
      reviews: z.array(
        z.object({
          model: organizationSchema,
          advice: jobsAdviceSchema.optional(),
          error: z.string().optional(),
        }),
      ),
    })
    .optional(),
  applied: z.object({ at: z.string(), title: z.string(), description: z.string() }).optional(),
})
export type JobsSession = z.infer<typeof jobsSessionSchema>
export type JobsRevision = JobsSession['revisions'][number]
export type JobsPending = NonNullable<JobsSession['pending']>

export const jobsReviewSummarySchema = z.object({
  ticket: z.string(),
  sessionId: z.string(),
  createdAt: z.string(),
  verdict: jobsAdviceSchema.shape.verdict,
  questionCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  applied: z.boolean(),
})
export type JobsReviewSummary = z.infer<typeof jobsReviewSummarySchema>

export const jobsVerdictLabels: Record<JobsAdvice['verdict'], string> = {
  ready: 'Ready to build',
  'needs-work': 'Needs work',
  uncertain: 'More context needed',
}
export const jobsSeverityLabels: Record<JobsFinding['severity'], string> = {
  blocking: 'Blocking',
  important: 'Important',
  polish: 'Polish',
}

export function validateJobsAdvice(
  ticket: { description: string },
  input: unknown,
  askedQuestions: string[] = [],
): JobsAdvice {
  const advice = jobsAdviceSchema.parse(input)
  unique(
    advice.findings.map((finding) => finding.id),
    'finding',
  )
  unique(
    advice.questions.map((question) => question.id),
    'question',
  )
  for (const finding of advice.findings)
    if (finding.reference && !ticket.description.includes(finding.reference))
      throw new Error('A Jobs finding referenced a passage outside this ticket.')
  const asked = new Set(askedQuestions)
  if (advice.resolved.some((id) => !asked.has(id)))
    throw new Error('Jobs resolved a question that was never asked.')
  const blocking = advice.findings.some((finding) => finding.severity === 'blocking')
  if (advice.verdict === 'ready' && (advice.questions.length || blocking))
    throw new Error('A ready ticket cannot have open questions or blocking findings.')
  if (advice.verdict === 'needs-work' && !advice.findings.length && !advice.questions.length)
    throw new Error('A needs-work verdict needs a finding or a question.')
  const rank = { blocking: 0, important: 1, polish: 2 }
  advice.findings.sort((a, b) => rank[a.severity] - rank[b.severity])
  return advice
}

function unique(ids: string[], kind: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Each Jobs ${kind} needs a unique ID.`)
}

export function latestJobsAdvice(session: JobsSession | undefined): JobsRevision | undefined {
  return session?.revisions.at(-1)
}

/** Has the ticket changed in Linear since this session last read it? */
export function jobsSnapshotMatches(
  session: Pick<JobsSession, 'snapshot'>,
  ticket: { title: string; description: string },
): boolean {
  return (
    session.snapshot?.title === ticket.title && session.snapshot.description === ticket.description
  )
}

export type JobsExpression = 'neutral' | 'thinking' | 'happy' | 'resigned' | 'angry'
export function jobsExpression(session: JobsSession | undefined): JobsExpression {
  if (!session || session.status === 'cancelled') return 'neutral'
  if (session.status === 'running' || session.status === 'partial') return 'thinking'
  if (session.status === 'failed') return 'resigned'
  const advice = latestJobsAdvice(session)?.advice
  if (!advice) return 'neutral'
  if (advice.verdict === 'ready') return 'happy'
  if (advice.verdict === 'uncertain') return 'thinking'
  return advice.findings.some((finding) => finding.severity === 'blocking') ? 'angry' : 'neutral'
}
