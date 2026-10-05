import { randomUUID } from 'node:crypto'
import type { ReviewerStore } from '../adapters/store'
import { organizePull } from './organization/organize'
import { JOB_RETENTION_MS } from '../limits'
import { UserError, publicError } from '../errors'

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
  private stopped = false
  constructor(private readonly store: ReviewerStore) {}

  start(pullId: string, force: boolean) {
    if (this.stopped) throw new UserError('The reviewer is shutting down.', 503)
    const organization = this.store.getPreferences().organization
    if (!organization)
      throw new UserError('Choose your coding provider and model in Settings first.')
    const pull = this.store.getPull(pullId)
    const running = [...this.jobs].find(
      ([, job]) => job.pullId === pull.id && job.status === 'running',
    )
    if (running) return { id: running[0] }
    if (!force && pull.groupingSource !== 'files') return { complete: true as const }
    const id = randomUUID()
    const job: Job = { status: 'running', controller: new AbortController(), pullId }
    this.jobs.set(id, job)
    const pending = organizePull(pull, organization, job.controller.signal)
      .then((groups) => {
        this.store.savePull({
          ...this.store.getPull(pullId),
          groups,
          groupingSource: organization.provider,
        })
        job.status = 'complete'
      })
      .catch((error: unknown) => {
        job.status = 'failed'
        job.error = publicError(error, 'Organization failed. Please retry.')
      })
      .finally(() => {
        this.pending.delete(pending)
        if (this.stopped) return
        const timer = setTimeout(() => {
          this.jobs.delete(id)
          this.timers.delete(timer)
        }, JOB_RETENTION_MS)
        timer.unref()
        this.timers.add(timer)
      })
    this.pending.add(pending)
    return { id }
  }

  get(id: string) {
    const job = this.jobs.get(id)
    if (!job) throw new UserError('This organization job is no longer available.', 404)
    return { status: job.status, error: job.error, pullId: job.pullId }
  }
  cancel(id: string) {
    this.jobs.get(id)?.controller.abort()
  }
  async close() {
    this.stopped = true
    for (const job of this.jobs.values()) job.controller.abort()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled(this.pending)
    this.jobs.clear()
  }
}
