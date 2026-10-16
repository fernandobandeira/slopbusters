import { publicError } from '../../errors'
import type { AgentSessions } from '../agent-sessions/agentSessions'

/** What every flow session carries, whatever it reviews, resolves or refines. */
export interface FlowSession {
  id: string
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
  progress: string
  error?: string
}

/** How a session ends when its work throws without being cancelled. */
export interface FlowFailure {
  /** Shown when the cause carries no message safe for the user. */
  fallback: string
  progress: string
}

interface Job<S> {
  controller: AbortController
  done: Promise<void>
  session: S
}

/**
 * The lifecycle every agent flow shares: one background job per session, cancellation through
 * an abort signal, a failure recorded on the session, and recovery of sessions the app stopped.
 * What a flow does inside its job (a panel, a debate, an interview) is the flow's own business.
 */
export class FlowJobs<S extends FlowSession> {
  private readonly jobs = new Map<string, Job<S>>()
  constructor(
    private readonly options: {
      save: (session: S) => void
      failure: FlowFailure
      sessions?: Pick<AgentSessions, 'diagnostic'>
    },
  ) {}

  isRunning(id: string): boolean {
    return this.jobs.has(id)
  }
  /** The live copy of a running session, which the job keeps updating. */
  session(id: string): S | undefined {
    return this.jobs.get(id)?.session
  }
  /** Every session with a live job. */
  active(): S[] {
    return [...this.jobs.values()].map((job) => job.session)
  }
  /** Run `work` in the background; when it throws without a cancel, the session fails. */
  launch(session: S, work: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController()
    const job: Job<S> = { controller, done: Promise.resolve(), session }
    this.jobs.set(session.id, job)
    job.done = work(controller.signal)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        this.fail(session, cause)
      })
      .finally(() => {
        if (this.jobs.get(session.id) === job) this.jobs.delete(session.id)
      })
  }
  abort(id: string): void {
    this.jobs.get(id)?.controller.abort()
  }
  /** A session saved as running that no job runs was stopped with the app; it is cancelled. */
  recover(session: S, progress: string): S {
    if (session.status === 'running' && !this.jobs.has(session.id)) {
      session.status = 'cancelled'
      this.progress(session, progress)
    }
    return session
  }
  /** Apply `stop` to every live session, then wait for their jobs to end. */
  async stop(stop: (session: S) => void): Promise<void> {
    const jobs = [...this.jobs.values()]
    for (const job of jobs) stop(job.session)
    await Promise.allSettled(jobs.map((job) => job.done))
  }
  /** Wait for jobs that were aborted but have not ended yet. */
  async settleAborted(): Promise<void> {
    await Promise.allSettled(
      [...this.jobs.values()].filter((job) => job.controller.signal.aborted).map((job) => job.done),
    )
  }
  progress(session: S, progress: string): void {
    session.progress = progress
    this.options.save(session)
  }
  private fail(session: S, cause: unknown) {
    const { fallback, progress } = this.options.failure
    this.options.sessions?.diagnostic(session.id, session.progress, cause)
    session.status = 'failed'
    session.error = publicError(cause, fallback)
    this.progress(session, progress)
  }
}
