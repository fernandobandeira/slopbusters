import { required } from './fixtures/bob'
import { describe, expect, it } from 'vitest'
import { jobsExpression, validateJobsAdvice } from '../shared/domain/jobs'
import { displayMarkdown, linearMarkdown, ticketIdentifierIn } from '../shared/domain/tickets'
import type { JobsSession } from '../shared/domain/jobs'
import { Provider } from '../shared/domain/types'
import { readRoute } from '../src/lib/routes'
import { fixtureDescription, fixtureJobsAdvice } from './fixtures/tickets'

describe('Linear Markdown', () => {
  it('writes collapses the way Linear stores them, not the way its API returns them', () => {
    expect(linearMarkdown(fixtureDescription)).toContain('+++ What happens to a late transfer?')
    expect(linearMarkdown(fixtureDescription)).not.toContain('>>>')
    expect(linearMarkdown('> quoted\n>> nested')).toBe('> quoted\n>> nested')
  })
  it('renders collapses as details and issue mentions as links', () => {
    const html = displayMarkdown(
      `${fixtureDescription}\n\nSee <issue id="1" href="https://linear.app/x/issue/SCH-1">SCH-1</issue>.`,
    )
    expect(html).toContain('<details><summary>What happens to a late transfer?</summary>')
    expect(html).toContain('</details>')
    expect(html).toContain('[SCH-1](https://linear.app/x/issue/SCH-1)')
  })
  it('escapes collapse labels so a ticket cannot inject markup', () => {
    expect(displayMarkdown('+++ <img src=x onerror=alert(1)>\nbody\n+++')).toContain(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })
  it('finds the issue a PR title, branch, or Linear link names', () => {
    expect(ticketIdentifierIn('PRD-4745 [1/3] Store the source number')).toBe('PRD-4745')
    expect(ticketIdentifierIn('fernando/prd-4752-backfill', { ignoreCase: true })).toBe('PRD-4752')
    expect(ticketIdentifierIn('https://linear.app/acme/issue/PRD-4681/p1-add-recovery')).toBe(
      'PRD-4681',
    )
    expect(ticketIdentifierIn('Fix utf-8 decoding')).toBeUndefined()
  })
})

describe('Jobs advice validation', () => {
  const ticket = { description: fixtureDescription }
  it('accepts findings that quote the ticket and ranks blocking ones first', () => {
    const advice = fixtureJobsAdvice({
      findings: [
        { ...required(fixtureJobsAdvice().findings[0]), id: 'polish', severity: 'polish' },
        { ...required(fixtureJobsAdvice().findings[0]), id: 'blocker', severity: 'blocking' },
      ],
    })
    expect(validateJobsAdvice(ticket, advice).findings.map((finding) => finding.id)).toEqual([
      'blocker',
      'polish',
    ])
  })
  it('rejects a quote that is not in the ticket', () => {
    const advice = fixtureJobsAdvice()
    required(advice.findings[0]).reference = 'A sentence the ticket never says.'
    expect(() => validateJobsAdvice(ticket, advice)).toThrow(/outside this ticket/)
  })
  it('keeps verdicts honest about open questions', () => {
    expect(() => validateJobsAdvice(ticket, fixtureJobsAdvice({ verdict: 'ready' }))).toThrow(
      /ready ticket/,
    )
    expect(() =>
      validateJobsAdvice(ticket, fixtureJobsAdvice({ findings: [], questions: [] })),
    ).toThrow(/needs-work/)
  })
  it('only resolves questions that were asked', () => {
    const advice = fixtureJobsAdvice({ resolved: ['late-transfer'] })
    expect(() => validateJobsAdvice(ticket, advice)).toThrow(/never asked/)
    expect(validateJobsAdvice(ticket, advice, ['late-transfer']).resolved).toEqual([
      'late-transfer',
    ])
  })
  it('shows Jobs thinking while he works and happy when the ticket is ready', () => {
    expect(jobsExpression(undefined)).toBe('neutral')
    const base: Omit<JobsSession, 'status' | 'revisions'> = {
      id: 's',
      ticket: 'SCH-760',
      repository: '',
      primary: { provider: Provider.codex, model: 'm' },
      companion: { provider: Provider.claude, model: 'm' },
      progress: '',
      createdAt: '',
    }
    expect(jobsExpression({ ...base, status: 'running', revisions: [] })).toBe('thinking')
    const ready = fixtureJobsAdvice({ verdict: 'ready', questions: [], findings: [] })
    const revision: JobsSession['revisions'][number] = {
      kind: 'review',
      advice: ready,
      reviewers: [],
      answers: [],
      createdAt: '',
    }
    expect(jobsExpression({ ...base, status: 'complete', revisions: [revision] })).toBe('happy')
  })
})

describe('issue routes', () => {
  it('opens the issue list and a single issue by its identifier', () => {
    expect(readRoute({ pathname: '/issues', search: '?view=created' })).toMatchObject({
      kind: 'issues',
      view: 'created',
    })
    expect(readRoute({ pathname: '/issues', search: '' })).toMatchObject({ view: 'assigned' })
    expect(readRoute({ pathname: '/issues/prd-4745', search: '' })).toMatchObject({
      kind: 'issue',
      identifier: 'PRD-4745',
    })
    expect(readRoute({ pathname: '/issues/not an id', search: '' })).toEqual({ kind: 'not-found' })
  })
})
