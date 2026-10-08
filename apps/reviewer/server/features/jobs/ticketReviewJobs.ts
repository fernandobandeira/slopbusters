import { randomUUID } from 'node:crypto'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import {
  jobsSnapshotMatches,
  latestJobsAdvice,
  type JobsAdvice,
  type JobsAnswer,
  type JobsSession,
} from '../../../shared/domain/jobs'
import {
  organizationDefaults,
  type OrganizationPreferences,
} from '../../../shared/domain/preferences'
import type { Ticket } from '../../../shared/domain/tickets'
import { Provider } from '../../../shared/domain/types'
import type { RepositoryContext } from '../../adapters/repositoryTools'
import type { ReviewerStore } from '../../adapters/store'
import { publicError, UserError } from '../../errors'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import type { TicketService } from '../tickets/tickets'
import { foldAnswers, loadJobsSkill, reconcileTicket, reviewTicket } from './ticketReview'

export interface TicketReviewOptions {
  store: ReviewerStore
  sessions?: AgentSessions
  staticDirectory: string
  skillDirectory?: string
  tickets: Pick<TicketService, 'get' | 'update'>
  evidence: (ticket: Ticket, signal: AbortSignal) => Promise<string>
  openSource?: (repository: string, signal: AbortSignal) => Promise<RepositoryContext>
}
interface Prepared {
  ticket: Ticket
  evidence: string
  skill: string
  repository?: RepositoryContext
  limitation?: string
}

const changedTicket =
  'The ticket changed in Linear since Jobs read it. Review it again to include those changes.'

/** Jobs reviews one ticket with two models, then folds the owner's answers with the primary. */
export class TicketReviewJobs {
  private running = new Map<string, { controller: AbortController; done: Promise<void> }>()
  constructor(private readonly options: TicketReviewOptions) {}

  start(ticket: string, repository = ''): JobsSession {
    const { primary, companion } = this.models()
    const previous = this.latest(ticket)
    if (previous?.status === 'running' && previous.pending?.kind !== 'answers') return previous
    if (previous?.status === 'running' || previous?.status === 'partial')
      throw new UserError('Finish or cancel the current Jobs review of this ticket first.')
    const session: JobsSession = {
      id: randomUUID(),
      ticket,
      repository,
      primary,
      companion,
      status: 'running',
      progress: 'Reading the ticket in Linear…',
      createdAt: new Date().toISOString(),
      revisions: [],
    }
    this.options.sessions?.start(session.id, 'jobs', { repository, urls: [] })
    this.save(session)
    this.launch(session)
    return session
  }
  answer(id: string, answers: JobsAnswer[]): JobsSession {
    const session = this.get(id)
    const revision = latestJobsAdvice(session)
    if (session.status === 'running' || session.status === 'partial' || !revision)
      throw new UserError('Wait for Jobs to finish reviewing before answering.')
    if (session.applied)
      throw new UserError('This proposal was applied. Review the ticket again to keep iterating.')
    const asked = new Set(revision.advice.questions.map((question) => question.id))
    if (!answers.length || answers.some((answer) => !asked.has(answer.questionId)))
      throw new UserError('Answer at least one of the questions Jobs asked.')
    Object.assign(session, {
      status: 'running',
      error: undefined,
      pending: { kind: 'answers', answers, reviews: [] },
      progress: 'Folding your answers into the ticket…',
    })
    this.save(session)
    this.launch(session)
    return session
  }
  async apply(id: string, changes: { title: string; description: string }) {
    const session = this.get(id)
    if (session.status !== 'complete' || !latestJobsAdvice(session))
      throw new UserError('Finish the Jobs review before applying it.')
    if (session.applied)
      throw new UserError('This proposal was already applied. Review the ticket again to iterate.')
    const ticket = await this.options.tickets.get(session.ticket, { refresh: true })
    if (!jobsSnapshotMatches(session, ticket)) throw new UserError(changedTicket, 409)
    const updated = await this.options.tickets.update(ticket, changes)
    session.applied = { at: new Date().toISOString(), ...changes }
    session.snapshot = snapshotOf(updated)
    this.save(session)
    return session
  }
  get(id: string): JobsSession {
    const session = this.options.store.tickets.getJobsSession(id)
    if (!session) throw new UserError('This Jobs review is no longer available.', 404)
    return this.recover(session)
  }
  latest(ticket: string): JobsSession | undefined {
    const session = this.options.store.tickets.latestJobsSession(ticket)
    return session && this.recover(session)
  }
  continue(id: string): JobsSession {
    const session = this.get(id)
    if (session.status !== 'partial' || !session.pending?.reviews.some((review) => review.advice))
      throw new UserError('There is no partial review to continue.')
    session.status = 'running'
    session.error = undefined
    this.progress(session, 'Reconciling the available review…')
    this.launch(session)
    return session
  }
  retry(id: string): JobsSession {
    const session = this.get(id)
    if (session.status === 'running' || this.running.has(id))
      throw new UserError('Wait for the current review to stop before retrying.')
    Object.assign(session, this.models(), { status: 'running', error: undefined })
    if (session.pending?.kind !== 'answers') session.pending = undefined
    this.progress(session, 'Retrying…')
    this.launch(session)
    return session
  }
  cancel(id: string): JobsSession {
    this.running.get(id)?.controller.abort()
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      if (session.pending?.kind !== 'answers') session.pending = undefined
      this.progress(session, 'Review cancelled. Earlier proposals are saved.')
    }
    return session
  }
  async close(): Promise<void> {
    const jobs = [...this.running.entries()]
    for (const [id] of jobs) this.cancel(id)
    await Promise.allSettled(jobs.map(([, job]) => job.done))
  }

  private models() {
    const { organization: primary, companion } = this.options.store.getPreferences()
    if (!primary) throw new UserError('Choose your primary model in Settings first.')
    return {
      primary,
      companion: companion ?? {
        provider: Provider.claude,
        model: organizationDefaults.claude.model,
      },
    }
  }
  private recover(session: JobsSession): JobsSession {
    if (session.status === 'running' && !this.running.has(session.id)) {
      session.status = 'cancelled'
      session.progress = 'Review interrupted when the app stopped. Earlier proposals are saved.'
      this.save(session)
    }
    return session
  }
  private launch(session: JobsSession): void {
    const controller = new AbortController()
    const job = { controller, done: Promise.resolve() }
    this.running.set(session.id, job)
    const work =
      session.pending?.kind === 'answers'
        ? this.fold(session, controller.signal)
        : this.review(session, controller.signal)
    job.done = work
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        this.options.sessions?.diagnostic(session.id, session.progress, cause)
        session.status = 'failed'
        session.error = publicError(cause, 'Jobs could not review this ticket.')
        this.progress(session, 'Review stopped. Earlier proposals are saved.')
      })
      .finally(() => {
        if (this.running.get(session.id) === job) this.running.delete(session.id)
      })
  }
  private async review(session: JobsSession, signal: AbortSignal) {
    const prepared = await this.prepare(session, signal, Boolean(session.pending))
    try {
      if (!session.pending) {
        this.progress(session, 'Two reviewers are reading the ticket…')
        session.pending = await this.reviewPair(session, prepared, signal)
        if (!this.canReconcile(session)) return
      }
      const pending = session.pending
      this.progress(session, 'The primary model is reconciling both reviews…')
      const advice = await this.pass(session, session.primary, 'Reconciliation', (observer) =>
        reconcileTicket({ ...this.request(prepared, session.primary, signal), pending, observer }),
      )
      this.finish(session, prepared, {
        advice,
        answers: [],
        kind: 'review',
        reviewers: pending.reviews.filter((review) => review.advice).map((review) => review.model),
      })
    } finally {
      await prepared.repository?.close()
    }
  }
  private async fold(session: JobsSession, signal: AbortSignal) {
    const previous = latestJobsAdvice(session)
    const answers = session.pending?.answers ?? []
    if (!previous) throw new UserError('Review the ticket before answering its questions.')
    const prepared = await this.prepare(session, signal, true)
    try {
      this.progress(session, 'Folding your answers into the ticket…')
      const advice = await this.pass(session, session.primary, 'Answers', (observer) =>
        foldAnswers({
          ...this.request(prepared, session.primary, signal),
          previous: previous.advice,
          answers,
          observer,
        }),
      )
      this.finish(session, prepared, {
        advice,
        answers,
        kind: 'answers',
        reviewers: [session.primary],
      })
    } finally {
      await prepared.repository?.close()
    }
  }
  private async prepare(session: JobsSession, signal: AbortSignal, keepSnapshot: boolean) {
    const skill = await loadJobsSkill(this.options.staticDirectory, this.options.skillDirectory)
    this.progress(session, 'Reading the ticket in Linear…')
    const ticket = await this.options.tickets.get(session.ticket, { refresh: true, signal })
    if (keepSnapshot && session.snapshot && !jobsSnapshotMatches(session, ticket))
      throw new UserError(changedTicket, 409)
    session.snapshot = snapshotOf(ticket)
    session.repository = ticket.pulls[0]?.repository ?? session.repository
    this.progress(session, 'Gathering the parent, children and linked PRs…')
    const evidence = await this.options.evidence(ticket, signal)
    const prepared: Prepared = { ticket, evidence, skill }
    if (!this.options.openSource || !session.repository) {
      prepared.limitation = 'No repository was selected, so claims about code were not verified.'
      return prepared
    }
    this.progress(session, `Preparing ${session.repository} for inspection…`)
    try {
      prepared.repository = await this.options.openSource(session.repository, signal)
    } catch (error) {
      signal.throwIfAborted()
      prepared.limitation = `Local repository inspection was unavailable: ${publicError(error, 'Source could not be prepared.')}`
    }
    return prepared
  }
  private request(prepared: Prepared, model: OrganizationPreferences, signal: AbortSignal) {
    return {
      evidence: prepared.evidence,
      ticket: prepared.ticket,
      model,
      skill: prepared.skill,
      signal,
      repository: prepared.repository,
    }
  }
  private async reviewPair(session: JobsSession, prepared: Prepared, signal: AbortSignal) {
    const models = [session.primary, session.companion] as const
    const outcomes = await Promise.allSettled(
      models.map((model, reviewer) =>
        this.pass(session, model, reviewer ? 'Companion review' : 'Primary review', (observer) =>
          reviewTicket({
            ...this.request(prepared, model, signal),
            companion: reviewer === 1,
            observer,
          }),
        ),
      ),
    )
    signal.throwIfAborted()
    return {
      kind: 'review' as const,
      answers: [],
      reviews: outcomes.map((outcome, reviewer) => ({
        model: models[reviewer === 0 ? 0 : 1],
        ...(outcome.status === 'fulfilled'
          ? { advice: outcome.value }
          : { error: publicError(outcome.reason, 'Reviewer failed.') }),
      })),
    }
  }
  private pass(
    session: JobsSession,
    model: OrganizationPreferences,
    label: string,
    execute: (observer?: ProviderObserver) => Promise<JobsAdvice>,
  ) {
    const sessions = this.options.sessions
    return sessions ? sessions.run(session.id, { model, label }, execute) : execute()
  }
  private canReconcile(session: JobsSession): boolean {
    const reviews = session.pending?.reviews ?? []
    const successes = reviews.filter((review) => review.advice).length
    if (!successes)
      throw new UserError(
        reviews
          .map((review) => `${review.model.provider}: ${review.error ?? 'No review.'}`)
          .join('\n'),
      )
    if (successes === 2) return true
    session.status = 'partial'
    session.error = reviews.find((review) => review.error)?.error
    this.progress(session, 'One reviewer failed. Retry both reviewers or continue with one.')
    return false
  }
  private finish(
    session: JobsSession,
    prepared: Prepared,
    revision: Omit<JobsSession['revisions'][number], 'createdAt'>,
  ) {
    if (prepared.limitation) revision.advice.limitations.unshift(prepared.limitation)
    session.revisions.push({ ...revision, createdAt: new Date().toISOString() })
    session.pending = undefined
    session.status = 'complete'
    this.progress(
      session,
      revision.kind === 'answers'
        ? 'Folded your answers into the proposal.'
        : 'Reviewed the ticket.',
    )
  }
  private save(session: JobsSession) {
    this.options.store.tickets.saveJobsSession(session)
    this.options.sessions?.sync('jobs', {
      id: session.id,
      repository: session.repository,
      urls: session.snapshot ? [session.snapshot.url] : [],
      status: session.status,
      progress: session.progress,
      createdAt: session.createdAt,
      error: session.error,
    })
  }
  private progress(session: JobsSession, progress: string) {
    session.progress = progress
    this.save(session)
  }
}

function snapshotOf(ticket: Ticket): NonNullable<JobsSession['snapshot']> {
  return {
    identifier: ticket.identifier,
    id: ticket.id,
    url: ticket.url,
    title: ticket.title,
    description: ticket.description,
    updatedAt: ticket.updatedAt,
  }
}
