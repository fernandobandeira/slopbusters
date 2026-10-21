import { randomUUID } from 'node:crypto'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { LayerSnapshot } from '../../../shared/domain/anchors'
import type {
  PanelPending,
  PanelPreparation,
  PanelReview,
  PanelReviewer,
  PanelSession,
  PanelSeatRequest,
} from '../../../shared/domain/panel'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { blocksNewReview, reviewedPullsLabel } from '../../../shared/domain/reviewSession'
import type { PullStackResult } from '../../../shared/domain/stacks'
import type { PullRequest } from '../../../shared/domain/types'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { publicError, UserError } from '../../errors'
import { PANEL_REVIEWER_CONCURRENCY } from '../../limits'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { FlowJobs } from '../flows/flowJobs'
import { failedSeats, reviewSeats } from '../flows/panel'
import type { PanelMembers } from './panelMembers'
import { layersOf, preparePanelRound } from './panelPreparation'
import { judgePanel, reviewAsPanelist } from './panelReview'

interface Options {
  store: PanelSessionStore
  turns: StructuredTurns
  members: PanelMembers
  /** The primary model judges; each seat reviews on the model for its provider. */
  models: () => { primary: OrganizationPreferences; companion?: OrganizationPreferences }
  loadPull: (url: string) => Promise<PullRequest>
  /** The PR's stack, so seats see its other open layers. */
  stack?: (url: string) => Promise<PullStackResult>
  sessions?: AgentSessions
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
  /** Evidence about what the PR is meant to do, such as its linked ticket. */
  context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
}

/** How a run treats a PR that already has reviews waiting: start over, rerun failures, or judge. */
type RunMode = 'fresh' | 'retry' | 'judge'

/**
 * A panel review: every chosen seat reviews each PR on its provider's model, a few at a time,
 * then a judge verifies their findings against the code and merges them into one result.
 */
export class PanelJobs {
  private readonly jobs: FlowJobs<PanelSession>
  constructor(private readonly options: Options) {
    this.jobs = new FlowJobs({
      save: (session) => {
        this.save(session)
      },
      sessions: options.sessions,
      failure: {
        fallback: 'The panel could not review these PRs.',
        progress: 'Panel review stopped. Judged PRs are saved.',
      },
    })
  }

  async start(
    repository: string,
    urls: string[],
    requests: PanelSeatRequest[],
  ): Promise<PanelSession> {
    const models = this.options.models()
    const reviewers = await this.options.members.describe(requests, models)
    const previous = this.latest(repository)
    if (previous && blocksNewReview(previous)) {
      if (sameRequest(previous, urls, reviewers)) return previous
      throw new UserError(
        `Finish or cancel the current panel review of ${reviewedPullsLabel(previous.urls)} before starting another.`,
        409,
      )
    }
    const session: PanelSession = {
      id: randomUUID(),
      repository,
      urls,
      model: models.primary,
      reviewers,
      status: 'running',
      progress: 'Loading PR snapshots and their stacks…',
      results: [],
      createdAt: new Date().toISOString(),
    }
    this.options.sessions?.start(session.id, 'panel', session)
    this.save(session)
    this.launch(session, 'fresh')
    return session
  }
  get(id: string): PanelSession {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    return this.recover(session)
  }
  latest(repository: string, url?: string): PanelSession | undefined {
    const session = this.options.store.latest(repository, url)
    return session && this.recover(session)
  }
  /** Judge with the reviews that finished, leaving the failed reviewers out. */
  continue(id: string): PanelSession {
    const session = this.get(id)
    if (session.status !== 'partial' || !session.pending?.reviews.some((review) => review.advice))
      throw new UserError('There is no partial panel review to continue.')
    return this.relaunch(session, 'judge', 'Judging the reviews that finished…')
  }
  /** Rerun only the reviewers that failed, or the whole PR when nothing is waiting. */
  retry(id: string): PanelSession {
    const session = this.get(id)
    if (session.status === 'running' || this.jobs.isRunning(id))
      throw new UserError('Wait for the current panel review to stop before retrying.')
    return this.relaunch(session, 'retry', 'Retrying the reviewers that did not finish…')
  }
  cancel(id: string): PanelSession {
    this.jobs.abort(id)
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      session.progress = 'Panel review cancelled. Judged PRs are saved.'
      session.pending = undefined
      this.save(session)
    }
    return session
  }
  async close(): Promise<void> {
    await this.jobs.stop((session) => this.cancel(session.id))
  }

  private relaunch(session: PanelSession, mode: RunMode, progress: string): PanelSession {
    session.status = 'running'
    session.error = undefined
    session.progress = progress
    this.save(session)
    this.launch(session, mode)
    return session
  }
  private recover(session: PanelSession): PanelSession {
    return this.jobs.recover(
      session,
      'Panel review interrupted when the app stopped. Judged PRs are saved.',
    )
  }
  private launch(session: PanelSession, mode: RunMode): void {
    this.jobs.launch(session, (signal) => this.run(session, signal, mode))
  }
  private async run(session: PanelSession, signal: AbortSignal, mode: RunMode): Promise<void> {
    const preparation = session.preparation ?? (await this.prepareRound(session, signal))
    for (let index = session.results.length; index < session.urls.length; index++) {
      signal.throwIfAborted()
      const usePending = mode !== 'fresh' && session.pending
      const round = { preparation, index, mode: usePending ? mode : 'fresh' } as const
      if (!(await this.reviewPull(session, signal, round))) return
      mode = 'fresh'
    }
    session.status = 'complete'
    this.progress(
      session,
      `The panel reviewed ${String(session.results.length)} PR${session.results.length === 1 ? '' : 's'}.`,
    )
  }
  /** Review one PR and judge it; false when it stops to wait for the user. */
  private async reviewPull(
    session: PanelSession,
    signal: AbortSignal,
    { preparation, index, mode }: { preparation: PanelPreparation; index: number; mode: RunMode },
  ): Promise<boolean> {
    let repository: ReviewCheckout | undefined
    try {
      const pending =
        mode === 'fresh' ? this.pendingFor(session, preparation, index) : session.pending
      if (!pending) throw new Error('Missing pending panel review.')
      const layers = layersOf(preparation, pending.pull.url)
      const source = await this.openSource(pending.pull, signal)
      repository = source.repository
      if (mode !== 'judge') await this.review(session, pending, { signal, repository, layers })
      if (!this.canJudge(session, pending, mode)) return false
      this.progress(
        session,
        `The judge is weighing the reviews of PR #${String(pending.pull.number)}…`,
      )
      const reviewers = session.reviewers.filter((reviewer) =>
        pending.reviews.some((review) => review.reviewer === reviewer.id && review.advice),
      )
      const skillFolders = await this.options.members.skillFolders(
        reviewers,
        session.model.provider,
      )
      const execute = (observer?: ProviderObserver) =>
        judgePanel({
          turns: this.options.turns,
          model: session.model,
          signal,
          repository,
          observer,
          pending,
          reviewers,
          skillFolders,
          layers,
        })
      const advice = await this.track(session, { label: 'Judge', url: pending.pull.url }, execute)
      signal.throwIfAborted()
      advice.limitations.unshift(...(preparation.missing[pending.pull.url] ?? []))
      if (source.limitation) advice.limitations.unshift(source.limitation)
      session.results.push({ ...pending, advice, reviews: pending.reviews })
      session.pending = undefined
      this.save(session)
      return true
    } finally {
      repository?.release()
    }
  }
  private pendingFor(session: PanelSession, preparation: PanelPreparation, index: number) {
    const url = session.urls[index]
    const snapshot = preparation.snapshots.find((entry) => entry.pull.url === url)
    if (!snapshot) throw new Error('Missing PR snapshot.')
    const pending: PanelPending = { ...snapshot, reviews: [] }
    session.pending = pending
    return pending
  }
  private async prepareRound(session: PanelSession, signal: AbortSignal) {
    const preparation = await preparePanelRound(session.urls, {
      ...this.options,
      signal,
      progress: (progress) => {
        this.progress(session, progress)
      },
    })
    session.preparation = preparation
    this.save(session)
    return preparation
  }
  /** The saved checkout of the PR head; without one, reviewers read the snapshot only. */
  private async openSource(
    pull: PullRequest,
    signal: AbortSignal,
  ): Promise<{ repository?: ReviewCheckout; limitation?: string }> {
    if (!this.options.openRepository) return {}
    try {
      return { repository: await this.options.openRepository(pull, signal) }
    } catch (error) {
      signal.throwIfAborted()
      return {
        limitation: `Local repository inspection was unavailable: ${publicError(error, 'Source could not be prepared.')} The panel used the supplied PR snapshot.`,
      }
    }
  }
  /** Run every reviewer that has no review yet, a few at a time, saving each as it lands. */
  private async review(
    session: PanelSession,
    pending: PanelPending,
    run: { signal: AbortSignal; repository?: ReviewCheckout; layers: LayerSnapshot[] },
  ) {
    pending.reviews = pending.reviews.filter((review) => review.advice)
    const waiting = session.reviewers.filter(
      (reviewer) => !pending.reviews.some((review) => review.reviewer === reviewer.id),
    )
    this.reportReviewers(session, pending)
    await reviewSeats(waiting, {
      signal: run.signal,
      concurrency: PANEL_REVIEWER_CONCURRENCY,
      review: (reviewer) => this.reviewOne(session, pending, reviewer, run),
      failure: (reviewer) => `${reviewer.name} failed.`,
      landed: (reviewer, { advice: seat, error }) => {
        pending.reviews.push({
          reviewer: reviewer.id,
          ...(seat
            ? {
                advice: seat.advice,
                ...(seat.capped ? { capped: true } : {}),
                ...(seat.unplaced.length ? { unplaced: seat.unplaced } : {}),
              }
            : {}),
          ...(error === undefined ? {} : { error }),
        })
        this.reportReviewers(session, pending)
      },
    })
  }
  private async reviewOne(
    session: PanelSession,
    pending: PanelPending,
    reviewer: PanelReviewer,
    {
      signal,
      repository,
      layers,
    }: { signal: AbortSignal; repository?: ReviewCheckout; layers: LayerSnapshot[] },
  ) {
    const model = reviewer.model ?? session.model
    const member = await this.options.members.load(reviewer, model.provider)
    const execute = (observer?: ProviderObserver) =>
      reviewAsPanelist({
        turns: this.options.turns,
        model,
        signal,
        repository,
        observer,
        member,
        pull: pending.pull,
        layers,
        context: pending.context,
      })
    const label = `${reviewer.name} review`
    return this.track(session, { label, url: pending.pull.url, model }, execute)
  }
  private canJudge(session: PanelSession, pending: PanelPending, mode: RunMode): boolean {
    const failed = failedSeats(
      pending.reviews,
      (review) => `${nameOf(session, review)}: ${review.error ?? 'No review.'}`,
    )
    if (!failed.length || mode === 'judge') return true
    session.status = 'partial'
    session.error = failed
      .map((review) => `${nameOf(session, review)}: ${review.error ?? ''}`)
      .join('\n')
    this.progress(
      session,
      `${failed.map((review) => nameOf(session, review)).join(', ')} could not finish. Retry them, or let the judge use the reviews that did.`,
    )
    return false
  }
  private reportReviewers(session: PanelSession, pending: PanelPending) {
    const done = pending.reviews.length
    this.progress(
      session,
      `${String(done)} of ${String(session.reviewers.length)} reviewers finished PR #${String(pending.pull.number)}…`,
    )
  }
  private track<T>(
    session: PanelSession,
    pass: { label: string; url: string; model?: OrganizationPreferences },
    execute: (observer?: ProviderObserver) => Promise<T>,
  ): Promise<T> {
    return this.options.sessions
      ? this.options.sessions.run(
          session.id,
          { ...pass, model: pass.model ?? session.model },
          execute,
        )
      : execute()
  }
  private save(session: PanelSession) {
    this.options.store.save(session)
    this.options.sessions?.sync('panel', session)
  }
  private progress(session: PanelSession, progress: string): void {
    session.progress = progress
    this.save(session)
  }
}

function sameRequest(session: PanelSession, urls: string[], reviewers: PanelReviewer[]) {
  const seats = (list: PanelReviewer[]) => list.map((reviewer) => [reviewer.id, reviewer.model])
  return (
    JSON.stringify(session.urls) === JSON.stringify(urls) &&
    JSON.stringify(seats(session.reviewers)) === JSON.stringify(seats(reviewers))
  )
}

function nameOf(session: PanelSession, review: PanelReview) {
  return (
    session.reviewers.find((reviewer) => reviewer.id === review.reviewer)?.name ?? review.reviewer
  )
}
