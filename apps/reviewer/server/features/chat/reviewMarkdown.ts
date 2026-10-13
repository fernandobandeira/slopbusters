import type { GandalfSession } from '../../../shared/domain/gandalf'
import {
  jobsSeverityLabels,
  jobsVerdictLabels,
  type JobsAdvice,
  type JobsAnswer,
} from '../../../shared/domain/jobs'
import { verdictLabels, type LinusAdvice } from '../../../shared/domain/linus'

/** Linus's review of one PR as compact Markdown: what he decided and what he walked through. */
export function linusReviewMarkdown(advice: LinusAdvice): string {
  return sections(
    `**Verdict: ${verdictLabels[advice.verdict]}**\n\n${advice.reasoning}`,
    advice.revisedTitle && `**Revised title:** ${advice.revisedTitle}`,
    advice.revisedDescription && `**Revised description:**\n\n${fenced(advice.revisedDescription)}`,
    advice.layers.length > 0 &&
      `**Proposed layers:**\n\n${advice.layers
        .map(
          (layer, index) =>
            `${String(index + 1)}. **${layer.title}** (depends on: ${layer.dependsOn.join(', ') || 'none'}). ${layer.reason} Verification: ${layer.verification}`,
        )
        .join('\n')}`,
    list(
      'What I walked you through',
      advice.steps.map((step) => step.text),
    ),
    list('Limitations', advice.limitations),
    list('Unresolved disagreements', advice.disagreements),
  )
}

/** Steve Jobs's review of an issue: verdict, findings, questions and the rewrite he proposed. */
export function jobsReviewMarkdown(advice: JobsAdvice, answers: JobsAnswer[]): string {
  return sections(
    `**Verdict: ${jobsVerdictLabels[advice.verdict]}**\n\n${advice.summary}`,
    list(
      'Findings',
      advice.findings.map(
        (finding) =>
          `**${jobsSeverityLabels[finding.severity]}: ${finding.title}** ${finding.body}${finding.reference ? ` (On: "${finding.reference}")` : ''}`,
      ),
    ),
    list(
      'Answers you gave me',
      answers.map((answer) => `${answer.question} **Answer:** ${answer.answer}`),
    ),
    list(
      'Open questions',
      advice.questions.map(
        (question) =>
          `**${question.topic}:** ${question.question} (for ${question.owner}; blocks ${question.blocks}${question.options.length ? `; options: ${question.options.join(' / ')}` : ''})`,
      ),
    ),
    `**Proposed rewrite:** ${advice.revisedTitle || '(title unchanged)'}\n\n${fenced(advice.revisedDescription)}`,
    list('Unverified claims', advice.unverified),
    list('Limitations', advice.limitations),
    list('Unresolved disagreements', advice.disagreements),
  )
}

/** What Gandalf did on one PR of a session, and what the session left undone. */
export function gandalfSessionMarkdown(session: GandalfSession, url: string): string {
  const result = session.results.find((item) => item.url === url)
  const turns = session.turns.filter((turn) => turn.url === url)
  const last = turns.at(-1)
  return sections(
    `**Task:** ${session.task === 'ci' ? 'fix the failing CI checks' : 'bring the PR up to date with its base branch and resolve the merge conflicts'}`,
    result &&
      `**Result:** ${
        result.published
          ? `pushed ${result.resolvedSha.slice(0, 8)} on top of ${result.headSha.slice(0, 8)} after ${String(result.rounds)} round${result.rounds === 1 ? '' : 's'}`
          : session.task === 'ci'
            ? 'no change was needed'
            : 'already up to date'
      }${result.changedPaths.length ? `. Changed: ${result.changedPaths.join(', ')}` : ''}`,
    list(
      'My turns on this PR',
      turns.map(
        (turn) =>
          `${turn.role === 'primary' ? 'Primary' : 'Secondary'}, round ${String(turn.round)}${turn.approved ? ', approved' : ''}: ${turn.summary}`,
      ),
    ),
    list('What remains', remaining(session, url, last)),
  )
}

function remaining(
  session: GandalfSession,
  url: string,
  last: GandalfSession['turns'][number] | undefined,
): string[] {
  const finished = new Set(session.results.map((result) => result.url))
  const items = [
    ...(last && !last.approved ? last.issues.map((issue) => `On this PR: ${issue}`) : []),
    ...session.urls
      .filter((other) => other !== url && !finished.has(other))
      .map((other) => `Not finished in this session: ${other}`),
  ]
  if (session.status !== 'complete' && session.status !== 'running')
    items.push(
      `The session ${session.status === 'failed' ? 'failed' : 'was cancelled'}${session.failureContext ? ` during ${session.failureContext}` : ''}${session.error ? `: ${session.error}` : '.'}`,
    )
  return items.length ? items : ['Nothing. Every PR in the session is done.']
}

function list(title: string, entries: string[]): string | false {
  return entries.length > 0 && `**${title}:**\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`
}

/** A Markdown document inside the review, fenced so its headings stay inside it. */
function fenced(markdown: string): string {
  const fence = '`'.repeat(
    Math.max(3, ...[...markdown.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)),
  )
  return `${fence}markdown\n${markdown}\n${fence}`
}

function sections(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join('\n\n')
}
