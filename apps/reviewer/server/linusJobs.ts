import { randomUUID } from 'node:crypto'
import type { LinusSession } from '../shared/linus'
import { organizationDefaults } from '../shared/preferences'
import { Provider } from '../shared/types'
import { fetchPull } from './github'
import { loadLinusSkill, pullFingerprint, reconcileWithLinus, reviewWithLinus } from './linusReview'
import type { ReviewerStore } from './store'

/** Review one PR at a time; only the two independent reviewers run concurrently. */
export class LinusJobs {
  private running = new Map<string, { controller: AbortController; done: Promise<void> }>()
  constructor(
    private store: ReviewerStore,
    private staticDirectory: string,
    private skillDirectory?: string,
  ) {}

  start(repository: string, urls: string[]): LinusSession {
    const { organization: primary, companion } = this.store.getPreferences()
    if (!primary) throw new Error('Choose your primary model in Settings first.')
    const second = companion ?? {
      provider: Provider.claude,
      model: organizationDefaults.claude.model,
    }
    const previous = this.latest(repository)
    if (
      previous?.status === 'running' &&
      JSON.stringify(previous.urls) === JSON.stringify(urls) &&
      JSON.stringify(previous.primary) === JSON.stringify(primary) &&
      JSON.stringify(previous.companion) === JSON.stringify(second)
    )
      return previous
    if (previous?.status === 'running' || previous?.status === 'partial')
      throw new Error('Finish or cancel the current Linus review before starting another.')
    const session: LinusSession = {
      id: randomUUID(),
      repository,
      urls,
      primary,
      companion: second,
      status: 'running',
      progress: 'Loading PR snapshots…',
      results: [],
      createdAt: new Date().toISOString(),
    }
    this.store.saveLinusSession(session)
    this.launch(session)
    return session
  }

  get(id: string): LinusSession {
    const session = this.store.getLinusSession(id)
    if (!session) throw new Error('This Linus review is no longer available.')
    return this.recover(session)
  }
  latest(repository: string): LinusSession | undefined {
    const session = this.store.latestLinusSession(repository)
    return session && this.recover(session)
  }
  private recover(session: LinusSession): LinusSession {
    if (session.status === 'running' && !this.running.has(session.id)) {
      session.status = 'cancelled'
      session.progress =
        'Review interrupted when the app stopped. Completed recommendations are saved.'
      this.store.saveLinusSession(session)
    }
    return session
  }

  continue(id: string): LinusSession {
    const session = this.get(id)
    if (session.status !== 'partial' || !session.pending?.reviews.some((review) => review.advice))
      throw new Error('There is no partial review to continue.')
    session.status = 'running'
    session.error = undefined
    session.progress = 'Reconciling the available review…'
    this.store.saveLinusSession(session)
    this.launch(session, true)
    return session
  }
  cancel(id: string): LinusSession {
    this.running.get(id)?.controller.abort()
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      session.progress = 'Review cancelled. Completed recommendations are saved.'
      session.pending = undefined
      this.store.saveLinusSession(session)
    }
    return session
  }
  retry(id: string): LinusSession {
    const session = this.get(id)
    if (session.status === 'running' || this.running.has(id))
      throw new Error('Wait for the current review to stop before retrying.')
    const { organization, companion } = this.store.getPreferences()
    if (!organization) throw new Error('Choose your primary model in Settings first.')
    session.primary = organization
    session.companion = companion ?? {
      provider: Provider.claude,
      model: organizationDefaults.claude.model,
    }
    session.status = 'running'
    session.pending = undefined
    session.error = undefined
    session.progress = 'Retrying the remaining PRs…'
    this.store.saveLinusSession(session)
    this.launch(session)
    return session
  }
  async close(): Promise<void> {
    const jobs = [...this.running.entries()]
    for (const [id] of jobs) this.cancel(id)
    await Promise.allSettled(jobs.map(([, job]) => job.done))
  }

  private launch(session: LinusSession, single = false): void {
    const controller = new AbortController()
    // Register before the async run can finish, so recovery distinguishes active work.
    const job = { controller, done: Promise.resolve() }
    this.running.set(session.id, job)
    job.done = this.run(session, controller.signal, single)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        session.status = 'failed'
        session.error = cause instanceof Error ? cause.message : 'Linus could not review these PRs.'
        session.progress = 'Review stopped. Completed recommendations are saved.'
        this.store.saveLinusSession(session)
      })
      .finally(() => this.running.delete(session.id))
  }

  private async run(session: LinusSession, signal: AbortSignal, single: boolean): Promise<void> {
    const skill = await loadLinusSkill(this.staticDirectory, this.skillDirectory)
    for (let index = session.results.length; index < session.urls.length; index++) {
      signal.throwIfAborted()
      if (!single || !session.pending) {
        session.progress = `Loading PR ${index + 1} of ${session.urls.length}…`
        this.store.saveLinusSession(session)
        const pull = await fetchPull(session.urls[index])
        signal.throwIfAborted()
        session.progress = `Two reviewers are looking at PR #${pull.number} (${index + 1} of ${session.urls.length})…`
        this.store.saveLinusSession(session)
        const models = [session.primary, session.companion]
        const outcomes = await Promise.allSettled(
          models.map((model, reviewer) =>
            reviewWithLinus(pull, model, skill, signal, reviewer === 1),
          ),
        )
        signal.throwIfAborted()
        session.pending = {
          pull,
          fingerprint: pullFingerprint(pull),
          reviews: outcomes.map((outcome, reviewer) => ({
            model: models[reviewer],
            ...(outcome.status === 'fulfilled'
              ? { advice: outcome.value }
              : {
                  error:
                    outcome.reason instanceof Error ? outcome.reason.message : 'Reviewer failed.',
                }),
          })),
        }
        const successes = session.pending.reviews.filter((review) => review.advice).length
        if (successes === 0)
          throw new Error(
            session.pending.reviews
              .map((review) => `${review.model.provider}: ${review.error}`)
              .join('\n'),
          )
        if (successes === 1) {
          session.status = 'partial'
          session.progress =
            'One reviewer failed. Retry both reviewers or continue with the available review.'
          session.error = session.pending.reviews.find((review) => review.error)?.error
          this.store.saveLinusSession(session)
          return
        }
      }
      session.progress = `The primary model is reconciling PR #${session.pending!.pull.number}…`
      this.store.saveLinusSession(session)
      const pending = session.pending!
      const advice = await reconcileWithLinus(pending, session.primary, skill, signal)
      signal.throwIfAborted()
      session.results.push({
        pull: pending.pull,
        fingerprint: pending.fingerprint,
        advice,
        reviewers: pending.reviews.filter((review) => review.advice).map((review) => review.model),
      })
      session.pending = undefined
      single = false
      this.store.saveLinusSession(session)
    }
    session.status = 'complete'
    session.progress = `Reviewed ${session.results.length} PR${session.results.length === 1 ? '' : 's'}.`
    this.store.saveLinusSession(session)
  }
}
