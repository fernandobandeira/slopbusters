import type { AgentSessions } from './agent-sessions/agentSessions'
import type { ProviderObserver } from '../../shared/domain/agentSession'
import { randomUUID } from 'node:crypto'
import type { OrganizationPreferences } from '../../shared/domain/preferences'
import {
  blocksNewReview,
  reviewedPullsLabel,
  type PendingReview,
  type ReviewResult,
  type ReviewSession,
} from '../../shared/domain/reviewSession'
import type { PullRequest } from '../../shared/domain/types'
import { publicError, UserError } from '../errors'
import type { ReviewCheckout } from '../adapters/reviewWorkspaces'
import { pullFingerprint } from '../reviewSnapshot'
import { FlowJobs } from './flows/flowJobs'
import { failedSeats, reviewSeats } from './flows/panel'
import type { JobDependencies } from './jobDependencies'

/** What a dual review takes to start; PRs load from GitHub unless `loadPull` says otherwise. */
export type DualReviewDependencies = Pick<
  JobDependencies,
  'store' | 'turns' | 'sessions' | 'staticDirectory' | 'openRepository' | 'context'
> &
  Partial<Pick<JobDependencies, 'loadPull'>> & { skillDirectory?: string }

interface ReviewStrategy<
  Advice extends { limitations: string[] },
  Session extends ReviewSession<Advice>,
> {
  name: string
  kind: 'bob' | 'linus'
  sessions?: AgentSessions
  models: () => { primary: OrganizationPreferences; companion: OrganizationPreferences }
  skill: () => Promise<string>
  save: (session: Session) => void
  get: (id: string) => Session | undefined
  latest: (repository: string) => Session | undefined
  loadPull: (url: string) => Promise<PullRequest>
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
  /** Evidence about what the PR is meant to do, such as its linked ticket. */
  context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
  review: (request: {
    pull: PullRequest
    model: OrganizationPreferences
    skill: string
    signal: AbortSignal
    companion: boolean
    repository?: ReviewCheckout
    observer?: ProviderObserver
    context?: string
    guidance?: string
  }) => Promise<Advice>
  reconcile: (request: {
    pending: PendingReview<Advice>
    model: OrganizationPreferences
    skill: string
    signal: AbortSignal
    repository?: ReviewCheckout
    observer?: ProviderObserver
    guidance?: string
  }) => Promise<Advice>
  /** What follows a PR's result before it is saved, such as the panel Linus sends it on to. */
  onResult?: (session: Session, result: Session['results'][number]) => Promise<void>
}

/** What a session carries beyond the review itself, such as what the author asked for. */
type SessionExtras<Advice, Session extends ReviewSession<Advice>> = Omit<
  Session,
  Exclude<keyof ReviewSession<Advice>, 'guidance'>
>

/**
 * A panel of two seats running the same skill, one on each model, then a reconciliation on the
 * primary model, for each PR in turn.
 */
export class DualReviewJobs<
  Advice extends { limitations: string[] },
  Session extends ReviewSession<Advice> = ReviewSession<Advice>,
> {
  private readonly jobs: FlowJobs<Session>
  constructor(private strategy: ReviewStrategy<Advice, Session>) {
    this.jobs = new FlowJobs({
      save: (session) => {
        this.save(session)
      },
      sessions: strategy.sessions,
      failure: {
        fallback: `${strategy.name} could not review these PRs.`,
        progress: 'Review stopped. Completed recommendations are saved.',
      },
    })
  }

  start(
    repository: string,
    urls: string[],
    extras: SessionExtras<Advice, Session> = {} as SessionExtras<Advice, Session>,
  ): Session {
    const { primary, companion } = this.strategy.models()
    const previous = this.latest(repository)
    if (previous && blocksNewReview(previous)) {
      // Asking again for the same PRs reopens the review that is still waiting on the user.
      if (
        JSON.stringify(previous.urls) === JSON.stringify(urls) &&
        (previous.status === 'partial' ||
          JSON.stringify([previous.primary, previous.companion]) ===
            JSON.stringify([primary, companion]))
      )
        return previous
      throw new UserError(
        `Finish or cancel the current ${this.strategy.name} review of ${reviewedPullsLabel(previous.urls)} before starting another.`,
        409,
      )
    }
    const base: ReviewSession<Advice> = {
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
    const session = { ...base, ...extras } as Session
    this.strategy.sessions?.start(session.id, this.strategy.kind, session)
    this.save(session)
    this.launch(session)
    return session
  }
  get(id: string): Session {
    const session = this.strategy.get(id)
    if (!session) throw new UserError(`This ${this.strategy.name} review is no longer available.`)
    return this.recover(session)
  }
  latest(repository: string): Session | undefined {
    const session = this.strategy.latest(repository)
    return session && this.recover(session)
  }
  continue(id: string): Session {
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
  cancel(id: string): Session {
    this.jobs.abort(id)
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      session.progress = 'Review cancelled. Completed recommendations are saved.'
      session.pending = undefined
      this.save(session)
    }
    return session
  }
  retry(id: string): Session {
    const session = this.get(id)
    if (session.status === 'running' || this.jobs.isRunning(id))
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
    await this.jobs.stop((session) => this.cancel(session.id))
  }
  private recover(session: Session): Session {
    return this.jobs.recover(
      session,
      'Review interrupted when the app stopped. Completed recommendations are saved.',
    )
  }
  private launch(session: Session, single = false): void {
    this.jobs.launch(session, (signal) => this.run(session, signal, single))
  }
  private async run(session: Session, signal: AbortSignal, single: boolean): Promise<void> {
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
    session: Session
    signal: AbortSignal
    skill: string
    single: boolean
    index: number
  }): Promise<boolean> {
    const { session, signal, skill, single, index } = request
    let repository: ReviewCheckout | undefined
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
          guidance: session.guidance,
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
      const result: ReviewResult<Advice> = {
        pull: pending.pull,
        fingerprint: pending.fingerprint,
        advice,
        reviewers: pending.reviews.filter((review) => review.advice).map((review) => review.model),
      }
      session.results.push(result)
      session.pending = undefined
      await this.strategy.onResult?.(session, result)
      this.save(session)
      return true
    } finally {
      repository?.release()
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
    session: Session
    pull: PullRequest
    skill: string
    signal: AbortSignal
    repository?: ReviewCheckout
    context?: string
  }): Promise<PendingReview<Advice>> {
    const { session, pull, skill, signal, repository, context } = request
    this.progress(session, `Two reviewers are looking at PR #${String(pull.number)}…`)
    const models = [session.primary, session.companion] as const
    const outcomes = await reviewSeats([0, 1] as const, {
      signal,
      concurrency: models.length,
      failure: () => 'Reviewer failed.',
      review: (reviewer) => {
        const model = models[reviewer]
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
            guidance: session.guidance,
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
      },
    })
    return {
      pull,
      fingerprint: pullFingerprint(pull),
      ...(context ? { context } : {}),
      reviews: outcomes.map((outcome, reviewer) => ({
        model: models[reviewer === 0 ? 0 : 1],
        ...outcome,
      })),
    }
  }
  private canReconcile(session: Session): boolean {
    const failed = failedSeats(
      session.pending?.reviews ?? [],
      (review) => `${review.model.provider}: ${review.error ?? 'No review returned.'}`,
    )
    if (!failed.length) return true
    session.status = 'partial'
    session.error = failed.find((review) => review.error)?.error
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
  /** Save a session changed outside the review flow; the flow saves its own. */
  protected saveSession(session: Session) {
    this.save(session)
  }
  private save(session: Session) {
    this.strategy.save(session)
    this.strategy.sessions?.sync(this.strategy.kind, session)
  }
  private progress(session: Session, progress: string): void {
    this.jobs.progress(session, progress)
  }
}
