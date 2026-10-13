import type { BobSession } from '../../shared/domain/bob'
import type { GandalfSession } from '../../shared/domain/gandalf'
import type { JobsAdvice, JobsSession } from '../../shared/domain/jobs'
import type { LinusAdvice, LinusSession } from '../../shared/domain/linus'
import { Provider } from '../../shared/domain/types'
import { fixtureBobAdvice } from './bob'
import { fixturePull } from './pull'

/** Finished review sessions of each persona about the fixture PR, for chats that continue them. */
export const pull = fixturePull()
export const claude = { provider: Provider.claude, model: 'claude-opus-5-5' }
export const codex = { provider: Provider.codex, model: 'gpt-5.5' }
export const linusAdvice: LinusAdvice = {
  verdict: 'stack',
  reasoning: 'The permission rule and the audit entry are two changes.',
  revisedTitle: 'Require editor permissions for project updates',
  revisedDescription: '## Why\n\nViewers could edit projects.',
  layers: [
    { title: 'Check editor role', reason: 'The rule.', dependsOn: [], verification: 'Unit test' },
    { title: 'Audit updates', reason: 'The log.', dependsOn: [1], verification: 'Unit test' },
  ],
  limitations: ['CI was not run.'],
  disagreements: [],
  steps: [
    { text: 'Two changes share one PR.', emotion: 'thinking', target: 'overview', reference: '' },
  ],
}
export const jobsAdvice: JobsAdvice = {
  verdict: 'needs-work',
  summary: 'Nobody can tell when this is done.',
  findings: [
    {
      id: 'done',
      rule: 'done-means',
      severity: 'blocking',
      title: 'No definition of done',
      body: 'Say what a user sees when it works.',
      reference: '',
    },
  ],
  questions: [
    {
      id: 'scope',
      topic: 'Scope',
      question: 'Does this include archived projects?',
      owner: 'Product',
      blocks: 'the permission check',
      options: ['Yes', 'No'],
    },
  ],
  resolved: [],
  revisedTitle: 'Only editors can update projects',
  revisedDescription: '## Job\n\nKeep viewers from changing projects.',
  unverified: [],
  limitations: [],
  disagreements: [],
}

export function linusSession(overrides: Partial<LinusSession> = {}): LinusSession {
  return {
    id: 'linus-1',
    repository: 'review-room/example',
    urls: [pull.url],
    primary: claude,
    companion: codex,
    status: 'complete',
    progress: 'Reviewed 1 PR.',
    results: [{ pull, fingerprint: 'f', advice: linusAdvice, reviewers: [claude, codex] }],
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}
export function bobSession(overrides: Partial<BobSession> = {}): BobSession {
  const { pending: _pending, ...base } = linusSession()
  return {
    ...base,
    id: 'bob-1',
    results: [{ pull, fingerprint: 'f', advice: fixtureBobAdvice(), reviewers: [claude, codex] }],
    ...overrides,
  }
}
export function jobsSession(overrides: Partial<JobsSession> = {}): JobsSession {
  return {
    id: 'jobs-1',
    ticket: 'ENG-7',
    repository: 'review-room/example',
    primary: claude,
    companion: codex,
    status: 'complete',
    progress: 'Reviewed.',
    createdAt: '2026-10-01T00:00:00Z',
    snapshot: {
      identifier: 'ENG-7',
      id: 'issue-7',
      url: 'https://linear.app/example/issue/ENG-7',
      title: 'Lock down project edits',
      description: 'Viewers can edit.',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    revisions: [
      {
        kind: 'answers',
        advice: jobsAdvice,
        reviewers: [claude],
        answers: [{ questionId: 'who', question: 'Who may edit?', answer: 'Editors and admins.' }],
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    ...overrides,
  }
}
export function gandalfSession(overrides: Partial<GandalfSession> = {}): GandalfSession {
  const other = 'https://github.com/review-room/example/pull/129'
  return {
    id: 'gandalf-1',
    repository: 'review-room/example',
    task: 'conflicts',
    urls: [pull.url, other],
    primary: claude,
    companion: codex,
    status: 'failed',
    progress: 'Stopped.',
    error: 'The base moved again.',
    createdAt: '2026-10-01T00:00:00Z',
    turns: [
      {
        url: pull.url,
        role: 'primary',
        round: 1,
        summary: 'Kept both permission checks in canEditProject.',
        issues: [],
        approved: false,
        changedPaths: ['src/access/permissions.ts'],
        revision: 'r1',
      },
      {
        url: pull.url,
        role: 'secondary',
        round: 1,
        summary: 'The merge is sound.',
        issues: [],
        approved: true,
        changedPaths: [],
        revision: 'r1',
      },
    ],
    results: [
      {
        url: pull.url,
        number: pull.number,
        title: pull.title,
        headSha: pull.headSha,
        baseSha: pull.baseSha,
        resolvedSha: '1234567890abcdef',
        changedPaths: ['src/access/permissions.ts'],
        rounds: 1,
        published: true,
      },
    ],
    ...overrides,
  }
}
