import type { AgentSessions } from './agent-sessions/agentSessions'
import type { ProviderObserver } from '../../shared/domain/agentSession'
import { randomUUID } from 'node:crypto'
import type { OrganizationPreferences } from '../../shared/domain/preferences'
import type { PendingReview, ReviewSession } from '../../shared/domain/reviewSession'
import type { PullRequest } from '../../shared/domain/types'
import { publicError, UserError } from '../errors'
import type { RepositoryContext } from '../adapters/repositoryTools'
import { pullFingerprint } from '../reviewSnapshot'

interface ReviewStrategy<Advice extends { limitations: string[] }> {
  name: string
  sessions?: AgentSessions
  models: () => { primary: OrganizationPreferences; companion: OrganizationPreferences }
  skill: () => Promise<string>
  save: (session: ReviewSession<Advice>) => void
  get: (id: string) => ReviewSession<Advice> | undefined
  latest: (repository: string) => ReviewSession<Advice> | undefined
  loadPull: (url: string) => Promise<PullRequest>
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<RepositoryContext>
  /** Evidence about what the PR is meant to do, such as its linked ticket. */
  context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
  review: (request: {
    pull: PullRequest
    model: OrganizationPreferences
    skill: string
    signal: AbortSignal
    companion: boolean
    repository?: RepositoryContext
    observer?: ProviderObserver
    context?: string
  }) => Promise<Advice>
  reconcile: (request: {
    pending: PendingReview<Advice>
    model: OrganizationPreferences
    skill: string
    signal: AbortSignal
    repository?: RepositoryContext
    observer?: ProviderObserver
  }) => Promise<Advice>
}

/** Shared lifecycle for independent reviews, reconciliation, retry and recovery. */
export class DualReviewJobs<Advice extends { limitations: string[] }> {
  private running = new Map<string, { controller: AbortController; done: Promise<void> }>()
  constructor(private strategy: ReviewStrategy<Advice>) {}

  start(repository: string, urls: string[]): ReviewSession<Advice> {
    const { primary, companion } = this.strategy.models()
    const previous = this.latest(repository)
    if (
      previous?.status === 'running' &&
      JSON.stringify(previous.urls) === JSON.stringify(urls) &&
      JSON.stringify(previous.primary) === JSON.stringify(primary) &&
      JSON.stringify(previous.companion) === JSON.stringify(companion)
    )
      return previous
    if (previous?.status === 'running' || previous?.status === 'partial')
      throw new UserError(
        `Finish or cancel the current ${this.strategy.name} review before starting another.`,
      )
    const session: ReviewSession<Advice> = {
      id: randomUUID(),
      repository,
      urls,
      primary,
      companion,
      status: 'running',
      progress: 'Loading PR snapshots…',
      results: [],
      createdAt: new Date().toISOString(),
    }
    this.strategy.sessions?.start(
      session.id,
      this.strategy.name === 'Bob' ? 'bob' : 'linus',
      session,
    )
    this.save(session)
    this.launch(session)
    return session
  }
  get(id: string): ReviewSession<Advice> {
    const session = this.strategy.get(id)
    if (!session) throw new UserError(`This ${this.strategy.name} review is no longer available.`)
    return this.recover(session)
  }
  latest(repository: string): ReviewSession<Advice> | undefined {
    const session = this.strategy.latest(repository)
    return session && this.recover(session)
  }
  continue(id: string): ReviewSession<Advice> {
    const session = this.get(id)
    if (session.status !== 'partial' || !session.pending?.reviews.some((review) => review.advice))
      throw new UserError('There is no partial review to continue.')
    session.status = 'running'
    session.error = undefined
    session.progress = 'Reconciling the available review…'
    this.save(session)
    this.launch(session, true)
    return session
  }
  cancel(id: string): ReviewSession<Advice> {
    this.running.get(id)?.controller.abort()
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      session.progress = 'Review cancelled. Completed recommendations are saved.'
      session.pending = undefined
      this.save(session)
    }
    return session
  }
  retry(id: string): ReviewSession<Advice> {
    const session = this.get(id)
    if (session.status === 'running' || this.running.has(id))
      throw new UserError('Wait for the current review to stop before retrying.')
    Object.assign(session, this.strategy.models(), {
      status: 'running',
      pending: undefined,
      error: undefined,
      progress: 'Retrying the remaining PRs…',
    })
    this.save(session)
    this.launch(session)
    return session
  }
  async close(): Promise<void> {
    const jobs = [...this.running.entries()]
    for (const [id] of jobs) this.cancel(id)
    await Promise.allSettled(jobs.map(([, job]) => job.done))
  }
  private recover(session: ReviewSession<Advice>): ReviewSession<Advice> {
    if (session.status === 'running' && !this.running.has(session.id)) {
      session.status = 'cancelled'
      session.progress =
        'Review interrupted when the app stopped. Completed recommendations are saved.'
      this.save(session)
    }
    return session
  }
  private launch(session: ReviewSession<Advice>, single = false): void {
    const controller = new AbortController()
    const job = { controller, done: Promise.resolve() }
    this.running.set(session.id, job)
    job.done = this.run(session, controller.signal, single)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        this.strategy.sessions?.diagnostic(session.id, session.progress, cause)
        session.status = 'failed'
        session.error = publicError(cause, `${this.strategy.name} could not review these PRs.`)
        session.progress = 'Review stopped. Completed recommendations are saved.'
        this.save(session)
      })
      .finally(() => {
        if (this.running.get(session.id) === job) this.running.delete(session.id)
      })
  }
  private async run(
    session: ReviewSession<Advice>,
    signal: AbortSignal,
    single: boolean,
  ): Promise<void> {
    const skill = await this.strategy.skill()
    for (let index = session.results.length; index < session.urls.length; index++) {
      signal.throwIfAborted()
      if (!(await this.reviewNext({ session, signal, skill, single, index }))) return
      single = false
    }
    session.status = 'complete'
    this.progress(
      session,
      `Reviewed ${String(session.results.length)} PR${session.results.length === 1 ? '' : 's'}.`,
    )
  }
  private async reviewNext(request: {
    session: ReviewSession<Advice>
    signal: AbortSignal
    skill: string
    single: boolean
    index: number
  }): Promise<boolean> {
    const { session, signal, skill, single, index } = request
    let repository: RepositoryContext | undefined
    try {
      if (!single || !session.pending) {
        this.progress(session, `Loading PR ${String(index + 1)} of ${String(session.urls.length)}…`)
        const url = session.urls[index]
        if (!url) throw new Error('Missing PR URL.')
        const pull = await this.strategy.loadPull(url)
        signal.throwIfAborted()
        const source = await this.prepareSource(pull, signal)
        repository = source.repository
        const context = await this.strategy.context?.(pull, signal)
        signal.throwIfAborted()
        const pending = await this.reviewPair({ session, pull, skill, signal, repository, context })
        this.addSourceLimitation(pending, source.limitation)
        session.pending = pending
        if (!this.canReconcile(session)) return false
      }
      const pending = session.pending
      if (single) {
        const source = await this.prepareSource(pending.pull, signal)
        repository = source.repository
        this.addSourceLimitation(pending, source.limitation)
      }
      this.progress(session, `The primary model is reconciling PR #${String(pending.pull.number)}…`)
      const execute = (observer?: ProviderObserver) =>
        this.strategy.reconcile({
          pending,
          model: session.primary,
          skill,
          signal,
          repository,
          observer,
        })
      const advice = this.strategy.sessions
        ? await this.strategy.sessions.run(
            session.id,
            { model: session.primary, label: 'Reconciliation', url: pending.pull.url },
            execute,
          )
        : await execute()
      this.preserveSourceLimitations(pending, advice)
      signal.throwIfAborted()
      session.results.push({
        pull: pending.pull,
        fingerprint: pending.fingerprint,
        advice,
        reviewers: pending.reviews.filter((review) => review.advice).map((review) => review.model),
      })
      session.pending = undefined
      this.save(session)
      return true
    } finally {
      await repository?.close()
    }
  }
  private async prepareSource(pull: PullRequest, signal: AbortSignal) {
    if (!this.strategy.openRepository) return {}
    try {
      return { repository: await this.strategy.openRepository(pull, signal) }
    } catch (error) {
      signal.throwIfAborted()
      return {
        limitation: `Local repository inspection was unavailable: ${publicError(error, 'Source could not be prepared.')} Review used the supplied PR snapshot.`,
      }
    }
  }
  private async reviewPair(request: {
    session: ReviewSession<Advice>
    pull: PullRequest
    skill: string
    signal: AbortSignal
    repository?: RepositoryContext
    context?: string
  }): Promise<PendingReview<Advice>> {
    const { session, pull, skill, signal, repository, context } = request
    this.progress(session, `Two reviewers are looking at PR #${String(pull.number)}…`)
    const models = [session.primary, session.companion] as const
    const outcomes = await Promise.allSettled(
      models.map((model, reviewer) => {
        const execute = (observer?: ProviderObserver) =>
          this.strategy.review({
            pull,
            model,
            skill,
            signal,
            companion: reviewer === 1,
            repository,
            observer,
            context,
          })
        return this.strategy.sessions
          ? this.strategy.sessions.run(
              session.id,
              {
                model,
                label: reviewer === 0 ? 'Primary review' : 'Companion review',
                url: pull.url,
              },
              execute,
            )
          : execute()
      }),
    )
    signal.throwIfAborted()
    return {
      pull,
      fingerprint: pullFingerprint(pull),
      ...(context ? { context } : {}),
      reviews: outcomes.map((outcome, reviewer) => ({
        model: models[reviewer === 0 ? 0 : 1],
        ...(outcome.status === 'fulfilled'
          ? { advice: outcome.value }
          : { error: publicError(outcome.reason, 'Reviewer failed.') }),
      })),
    }
  }
  private canReconcile(session: ReviewSession<Advice>): boolean {
    const reviews = session.pending?.reviews ?? []
    const successes = reviews.filter((review) => review.advice).length
    if (!successes)
      throw new UserError(
        reviews
          .map((review) => `${review.model.provider}: ${review.error ?? 'No review returned.'}`)
          .join('\n'),
      )
    if (successes === 2) return true
    session.status = 'partial'
    session.error = reviews.find((review) => review.error)?.error
    this.progress(
      session,
      'One reviewer failed. Retry both reviewers or continue with the available review.',
    )
    return false
  }
  private addSourceLimitation(pending: PendingReview<Advice>, limitation?: string): void {
    if (!limitation) return
    for (const review of pending.reviews) review.advice?.limitations.unshift(limitation)
  }
  private preserveSourceLimitations(pending: PendingReview<Advice>, advice: Advice): void {
    const limitations = pending.reviews.flatMap((review) => review.advice?.limitations ?? [])
    for (const limitation of new Set(
      limitations.filter((text) => text.startsWith('Local repository inspection was unavailable:')),
    ))
      if (!advice.limitations.includes(limitation)) advice.limitations.unshift(limitation)
  }
  private save(session: ReviewSession<Advice>) {
    this.strategy.save(session)
    this.strategy.sessions?.sync(this.strategy.name === 'Bob' ? 'bob' : 'linus', session)
  }
  private progress(session: ReviewSession<Advice>, progress: string): void {
    session.progress = progress
    this.save(session)
  }
}
