import type { AgentSessions } from './agent-sessions/agentSessions'
import type { ProviderObserver } from '../../shared/domain/agentSession'
import { randomUUID } from 'node:crypto'
import type { ReviewerStore } from '../adapters/store'
import type { StructuredTurns } from '../adapters/t3Engine/engineTurns'
import type { PullRequest } from '../../shared/domain/types'
import { groupingPrompt, organizePull } from './organization/organize'
import { savedModels } from './models'
import type { JobDependencies } from './jobDependencies'
import { GROUPING_CONCURRENCY, JOB_RETENTION_MS } from '../limits'
import { UserError, logError, publicError } from '../errors'
import { Slots } from './flows/slots'

type Job = {
  status: 'running' | 'complete' | 'failed'
  error?: string
  controller: AbortController
  pullId: string
}

export class OrganizationJobs {
  private readonly jobs = new Map<string, Job>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly pending = new Set<Promise<void>>()
  private readonly slots = new Slots(GROUPING_CONCURRENCY)
  private stopped = false
  private readonly store: ReviewerStore
  private readonly turns: StructuredTurns
  private readonly sessions?: AgentSessions
  constructor({ store, turns, sessions }: Pick<JobDependencies, 'store' | 'turns' | 'sessions'>) {
    this.store = store
    this.turns = turns
    this.sessions = sessions
  }

  start(pullId: string, force: boolean) {
    if (this.stopped) throw new UserError('The reviewer is shutting down.', 503)
    const organization = savedModels(this.store.getPreferences()).primary
    const pull = this.store.getPull(pullId)
    return this.enqueue(pull, organization, { force })
  }

  /** Let the panel publish its result before doing any snapshot I/O or grouping work. */
  organizeReviewedPull(pull: PullRequest, panelSignal: AbortSignal): void {
    setImmediate(() => {
      if (this.stopped) return
      try {
        this.startBackground(this.store.saveFetchedPull(pull), panelSignal)
      } catch (error) {
        logError(`Saving or organizing the reviewed PR ${pull.url}.`, error)
      }
    })
  }

  private startBackground(pull: PullRequest, panelSignal: AbortSignal) {
    if (panelSignal.aborted || pull.groupingSource !== 'files') return
    const organization = savedModels(this.store.getPreferences()).primary
    const prepared = groupingPrompt(pull)
    if ('reason' in prepared) return
    this.enqueue(pull, organization, { prepared, panelSignal })
  }

  private enqueue(
    pull: PullRequest,
    organization: ReturnType<typeof savedModels>['primary'],
    options: {
      force?: boolean
      prepared?: ReturnType<typeof groupingPrompt>
      panelSignal?: AbortSignal
    },
  ) {
    const running = [...this.jobs].find(
      ([, job]) => job.pullId === pull.id && job.status === 'running',
    )
    if (running) return { id: running[0] }
    if (!options.force && pull.groupingSource !== 'files') return { complete: true as const }
    const id = randomUUID()
    const job: Job = { status: 'running', controller: new AbortController(), pullId: pull.id }
    this.sessions?.start(id, 'grouping', {
      repository: `${pull.owner}/${pull.repo}`,
      urls: [pull.url],
    })
    this.jobs.set(id, job)
    const { prepared, panelSignal } = options
    const signal = job.controller.signal
    const abort = () => {
      job.controller.abort()
    }
    panelSignal?.addEventListener('abort', abort, { once: true })
    const execute = (observer?: ProviderObserver) =>
      organizePull(this.turns, pull, organization, {
        signal,
        observer,
        ...(prepared && { prepared }),
      })
    const turn = () => {
      signal.throwIfAborted()
      return this.sessions
        ? this.sessions.run(
            id,
            { model: organization, label: 'Organize diff', url: pull.url },
            execute,
            signal,
          )
        : execute()
    }
    // Someone waiting on the review screen is never queued behind grouping no one is watching.
    const operation = panelSignal ? this.slots.run(signal, turn) : Promise.resolve().then(turn)
    const pending = operation
      .then((groups) => {
        job.controller.signal.throwIfAborted()
        this.store.savePull({
          ...this.store.getPull(pull.id),
          groups,
          groupingSource: organization.provider,
        })
        job.status = 'complete'
        this.sessions?.update({ id, status: 'complete', progress: 'Diff organized.' })
      })
      .catch((error: unknown) => {
        job.status = 'failed'
        job.error = signal.aborted
          ? 'Organization cancelled.'
          : publicError(error, 'Organization failed. Please retry.')
        if (!signal.aborted) this.sessions?.diagnostic(id, 'Organizing diff', error)
        this.sessions?.update({
          id,
          status: signal.aborted ? 'cancelled' : 'failed',
          progress: 'Organization stopped.',
          error: job.error,
        })
      })
      .catch((error: unknown) => {
        logError('Recording organization failure.', error)
      })
      .finally(() => {
        panelSignal?.removeEventListener('abort', abort)
        this.pending.delete(pending)
        this.expire(id)
      })
    this.pending.add(pending)
    return { id }
  }

  private expire(id: string): void {
    if (this.stopped) return
    const timer = setTimeout(() => {
      this.jobs.delete(id)
      this.timers.delete(timer)
    }, JOB_RETENTION_MS)
    timer.unref()
    this.timers.add(timer)
  }

  get(id: string) {
    const job = this.jobs.get(id)
    if (!job) throw new UserError('This organization job is no longer available.', 404)
    return { status: job.status, error: job.error, pullId: job.pullId }
  }
  cancel(id: string) {
    const job = this.jobs.get(id)
    if (job?.status === 'running') job.controller.abort()
  }
  async close() {
    this.stopped = true
    for (const id of this.jobs.keys()) this.cancel(id)
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled(this.pending)
    this.jobs.clear()
  }
}
