import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewerStore } from '../server/adapters/store'
import {
  foldAnswers,
  loadJobsSkill,
  reconcileTicket,
  reviewTicket,
} from '../server/features/jobs/ticketReview'
import { TicketReviewJobs } from '../server/features/jobs/ticketReviewJobs'
import type { Ticket } from '../shared/domain/tickets'
import { Provider } from '../shared/domain/types'
import { required } from './fixtures/bob'
import { fixtureJobsAdvice, fixtureTicket } from './fixtures/tickets'

vi.mock('../server/features/jobs/ticketReview', () => ({
  loadJobsSkill: vi.fn(),
  reviewTicket: vi.fn(),
  reconcileTicket: vi.fn(),
  foldAnswers: vi.fn(),
}))
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
let directory: string
let store: ReviewerStore
let current: Ticket
let jobs: TicketReviewJobs
const update = vi.fn((_ticket: Ticket, changes: { title: string; description: string }) => {
  current = { ...current, ...changes }
  return Promise.resolve(current)
})
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'jobs-review-'))
  store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: primary, companion })
  current = fixtureTicket()
  jobs = new TicketReviewJobs({
    store,
    staticDirectory: directory,
    tickets: { get: () => Promise.resolve(current), update },
    evidence: (ticket) => Promise.resolve(JSON.stringify({ ticket: ticket.identifier })),
  })
  vi.mocked(loadJobsSkill).mockResolvedValue('Jobs skill')
  vi.mocked(reviewTicket).mockImplementation(() => Promise.resolve(fixtureJobsAdvice()))
  vi.mocked(reconcileTicket).mockImplementation(() => Promise.resolve(fixtureJobsAdvice()))
  vi.mocked(foldAnswers).mockImplementation(() =>
    Promise.resolve(
      fixtureJobsAdvice({
        verdict: 'ready',
        questions: [],
        findings: [],
        resolved: ['late-transfer'],
      }),
    ),
  )
})
afterEach(async () => {
  await jobs.close()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

async function reviewed() {
  const session = jobs.start('SCH-760')
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  return session.id
}

describe('Jobs ticket review', () => {
  it('has both models read the ticket, then the primary reconciles a proposal', async () => {
    const id = await reviewed()

    expect(vi.mocked(reviewTicket).mock.calls.map(([request]) => request.model)).toEqual([
      primary,
      companion,
    ])
    const session = jobs.get(id)
    expect(session.snapshot?.description).toBe(current.description)
    expect(session.revisions[0]?.reviewers).toEqual([primary, companion])
    expect(session.revisions[0]?.advice.limitations[0]).toMatch(/No repository was selected/)
    expect(store.tickets.jobsReviews()).toEqual([
      expect.objectContaining({ ticket: 'SCH-760', verdict: 'needs-work', questionCount: 1 }),
    ])
  })
  it('folds the owner’s answers into the latest proposal', async () => {
    const id = await reviewed()
    const answers = [
      { questionId: 'late-transfer', question: 'Who refunds?', answer: 'Operations, by hand' },
    ]

    jobs.answer(id, answers)
    await vi.waitFor(() => {
      expect(jobs.get(id).revisions).toHaveLength(2)
    })

    const request = vi.mocked(foldAnswers).mock.calls[0]?.[0]
    expect(request?.previous).toEqual(jobs.get(id).revisions[0]?.advice)
    expect(request?.answers).toEqual(answers)
    expect(jobs.get(id).revisions[1]).toMatchObject({ kind: 'answers', answers })
    expect(() => {
      jobs.answer(id, [{ ...required(answers[0]), questionId: 'invented' }])
    }).toThrow(/questions Jobs asked/)
  })
  it('refuses to fold or apply over a ticket someone changed in Linear', async () => {
    const id = await reviewed()
    current = { ...current, description: `${current.description}\nEdited by a teammate.` }

    await expect(jobs.apply(id, { title: 'New', description: 'Body' })).rejects.toThrow(
      /changed in Linear/,
    )
    jobs.answer(id, [{ questionId: 'late-transfer', question: 'q', answer: 'a' }])
    await vi.waitFor(() => {
      expect(jobs.get(id).status).toBe('failed')
    })
    expect(jobs.get(id).error).toMatch(/changed in Linear/)
    expect(update).not.toHaveBeenCalled()
  })
  it('applies the edited proposal once and records what was written', async () => {
    const id = await reviewed()
    const changes = {
      title: 'Clinics collect deposits by transfer',
      description: '+++ Why?\nB\n+++',
    }

    const session = await jobs.apply(id, changes)

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'SCH-760' }), changes)
    expect(session.applied).toMatchObject(changes)
    await expect(jobs.apply(id, changes)).rejects.toThrow(/already applied/)
    expect(() =>
      jobs.answer(id, [{ questionId: 'late-transfer', question: 'q', answer: 'a' }]),
    ).toThrow(/was applied/)
  })
})
