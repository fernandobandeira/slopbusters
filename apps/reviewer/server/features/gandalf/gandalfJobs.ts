import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { GandalfSession, GandalfTurn } from '../../../shared/domain/gandalf'
import { organizationDefaults } from '../../../shared/domain/preferences'
import { Provider, type PullRequest } from '../../../shared/domain/types'
import type { ReviewerStore } from '../../adapters/store'
import type { ConflictWorkspace } from '../../adapters/conflictWorkspace'
import { BaseAdvancedError } from '../../adapters/conflictRevision'
import { CommandTimeoutError } from '../../adapters/process'
import { NetworkError } from '../../adapters/network'
import { UserError, publicError } from '../../errors'
import {
  GANDALF_NETWORK_RETRY_DELAYS_MS,
  MAX_GANDALF_BASE_RETRIES,
  MAX_GANDALF_TURNS,
  MAX_GANDALF_TIMEOUT_RETRIES,
} from '../../limits'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { resolveWithGandalf } from './gandalfResolution'

interface Options {
  store: ReviewerStore
  sessions?: AgentSessions
  loadPull: (url: string) => Promise<PullRequest>
  openWorkspace: (pull: PullRequest, signal: AbortSignal) => Promise<ConflictWorkspace>
  plan?: (urls: string[], signal: AbortSignal) => Promise<string[]>
  resolve?: typeof resolveWithGandalf
  networkRetryDelaysMs?: readonly number[]
}

export class GandalfJobs {
  private running = new Map<
    string,
    {
      controller: AbortController
      done: Promise<void>
      repository: string
      session: GandalfSession
    }
  >()
  private suspended = false
  constructor(private options: Options) {}

  start(repository: string, urls: string[]): GandalfSession {
    this.requireAwake()
    const previous = this.latest(repository)
    if (previous?.status === 'running') {
      if (JSON.stringify(previous.urls) === JSON.stringify(urls)) return previous
      throw new UserError('Finish or cancel the current Gandalf session first.')
    }
    if ([...this.running.values()].some((job) => job.repository === repository))
      throw new UserError('Wait for the previous Gandalf session to stop before starting another.')
    const session: GandalfSession = {
      id: randomUUID(),
      repository,
      urls,
      ...this.models(),
      status: 'running',
      progress: 'Preparing conflict resolution…',
      createdAt: new Date().toISOString(),
      results: [],
      turns: [],
    }
    this.options.sessions?.start(session.id, 'gandalf', session)
    this.save(session)
    this.launch(session)
    return session
  }
  get(id: string): GandalfSession {
    const session = this.options.store.getGandalfSession(id)
    if (!session) throw new UserError('This Gandalf session is no longer available.', 404)
    return session
  }
  latest(repository: string): GandalfSession | undefined {
    const session = this.options.store.latestGandalfSession(repository)
    return session
  }
  retry(id: string): GandalfSession {
    this.requireAwake()
    const session = this.get(id)
    if ([...this.running.values()].some((job) => job.repository === session.repository))
      throw new UserError('Wait for the current Gandalf session to stop before retrying.')
    Object.assign(session, this.models(), {
      status: 'running',
      error: undefined,
      failureContext: undefined,
      timeoutRetries: 0,
      networkRetries: 0,
      baseRetries: 0,
    })
    this.launch(session)
    this.save(session)
    return session
  }
  cancel(id: string): GandalfSession {
    const job = this.running.get(id)
    const session = job?.session ?? this.get(id)
    if (session.status === 'running') {
      session.status = 'cancelled'
      session.progress = 'Resolution cancelled. Completed PR updates are saved.'
      this.save(session)
    }
    job?.controller.abort()
    return session
  }
  async suspend() {
    this.suspended = true
    const jobs = [...this.running.values()]
    for (const job of jobs) {
      job.controller.abort()
      if (job.session.status === 'running')
        this.progress(job.session, 'Resolution paused. It will resume when the app is awake.')
    }
    await Promise.allSettled(jobs.map((job) => job.done))
  }
  async resume() {
    this.suspended = false
    await Promise.allSettled(
      [...this.running.values()]
        .filter((job) => job.controller.signal.aborted)
        .map((job) => job.done),
    )
    if (!this.isAwake()) return
    for (const session of this.options.store.pendingGandalfSessions()) {
      if ([...this.running.values()].some((job) => job.repository === session.repository)) continue
      this.progress(session, 'Resuming resolution. Rechecking the current stack…')
      this.launch(session)
    }
  }
  async close() {
    await this.suspend()
  }
  private requireAwake() {
    if (!this.isAwake()) throw new UserError('Wait for the app to wake before starting resolution.')
  }
  private isAwake() {
    return !this.suspended
  }
  private models() {
    const { organization: primary, companion } = this.options.store.getPreferences()
    if (!primary) throw new UserError('Choose your primary model in Settings first.')
    const provider = primary.provider === Provider.codex ? Provider.claude : Provider.codex
    return {
      primary,
      companion: companion ?? { provider, model: organizationDefaults[provider].model },
    }
  }
  private launch(session: GandalfSession) {
    const controller = new AbortController()
    const job = { controller, done: Promise.resolve(), repository: session.repository, session }
    this.running.set(session.id, job)
    job.done = this.runWithRecovery(session, controller.signal).finally(() => {
      this.running.delete(session.id)
    })
  }
  private async runWithRecovery(session: GandalfSession, signal: AbortSignal) {
    for (;;) {
      try {
        signal.throwIfAborted()
        await this.run(session, signal)
        return
      } catch (cause) {
        if (signal.aborted) return
        this.options.sessions?.diagnostic(session.id, session.progress, cause)
        if (await this.retryAutomatically(session, cause, signal)) continue
        session.failureContext = session.progress
        session.status = 'failed'
        session.error =
          cause instanceof CommandTimeoutError
            ? 'A resolution command timed out again. Retry the remaining PRs.'
            : publicError(cause, 'Gandalf stopped on an unexpected error. Retry the remaining PRs.')
        this.progress(session, 'Resolution stopped. Completed PR updates are saved.')
        return
      }
    }
  }
  /** Rechecks the stack from the start; published layers are detected as up to date. */
  private async retryAutomatically(session: GandalfSession, cause: unknown, signal: AbortSignal) {
    if (
      cause instanceof CommandTimeoutError &&
      (session.timeoutRetries ?? 0) < MAX_GANDALF_TIMEOUT_RETRIES
    ) {
      session.timeoutRetries = (session.timeoutRetries ?? 0) + 1
      this.progress(
        session,
        'A command timed out. Automatically retrying the unfinished resolution…',
      )
      return true
    }
    if (
      cause instanceof BaseAdvancedError &&
      (session.baseRetries ?? 0) < MAX_GANDALF_BASE_RETRIES
    ) {
      session.baseRetries = (session.baseRetries ?? 0) + 1
      this.progress(
        session,
        'A base branch gained commits during resolution. Rechecking the stack against them…',
      )
      return true
    }
    const delays = this.options.networkRetryDelaysMs ?? GANDALF_NETWORK_RETRY_DELAYS_MS
    const attempt = session.networkRetries ?? 0
    const delay = delays[attempt]
    if (!(cause instanceof NetworkError) || delay === undefined) return false
    session.networkRetries = attempt + 1
    this.progress(
      session,
      `GitHub did not respond. Retrying automatically in ${String(Math.round(delay / 1000))} seconds (attempt ${String(attempt + 1)} of ${String(delays.length)})…`,
    )
    // Cancellation and sleep end the wait; the loop then stops on the aborted signal.
    await sleep(delay, undefined, { signal }).catch(() => undefined)
    return true
  }
  private async run(session: GandalfSession, signal: AbortSignal) {
    this.progress(session, 'Refreshing the PR stack from GitHub…')
    session.urls = (await this.options.plan?.(session.urls, signal)) ?? session.urls
    signal.throwIfAborted()
    session.results = session.results.filter((result) => session.urls.includes(result.url))
    this.save(session)
    const verifications: (() => Promise<void>)[] = []
    for (const url of session.urls) {
      signal.throwIfAborted()
      verifications.push(await this.resolvePull(session, url, signal))
    }
    signal.throwIfAborted()
    this.progress(session, 'Verifying all updated branches…')
    for (const verify of verifications) {
      signal.throwIfAborted()
      await verify()
    }
    signal.throwIfAborted()
    session.status = 'complete'
    this.progress(session, 'You may pass. All PRs and their stack layers are up to date.')
  }
  private async resolvePull(session: GandalfSession, url: string, signal: AbortSignal) {
    this.progress(session, `Loading ${url}…`)
    const loaded = await this.options.loadPull(url)
    signal.throwIfAborted()
    if (loaded.state !== 'open') throw new UserError('Select open PRs for conflict resolution.')
    this.progress(session, `Preparing conflicts for PR #${loaded.number}…`)
    const workspace = await this.options.openWorkspace(loaded, signal)
    const pull = workspace.pull
    let resolvedSha = pull.headSha
    try {
      signal.throwIfAborted()
      if (!workspace.needsUpdate) {
        await workspace.verify()
        const previous = session.results.find((result) => result.url === url)
        this.saveResult(
          session,
          previous?.resolvedSha === pull.headSha && previous.baseSha === pull.baseSha
            ? previous
            : {
                url,
                number: pull.number,
                title: pull.title,
                headSha: pull.headSha,
                baseSha: pull.baseSha,
                resolvedSha: pull.headSha,
                changedPaths: [],
                rounds: 0,
                published: false,
              },
        )
      } else {
        // Old attempts are not evidence for this freshly fetched revision.
        session.turns = session.turns.filter((turn) => turn.url !== url)
        const rounds = await this.roundRobin({ session, pull, workspace, signal })
        signal.throwIfAborted()
        this.progress(session, `Both models agree. Updating PR #${pull.number}…`)
        resolvedSha = await workspace.publish()
        // Published progress earns a fresh budget for later connection drops.
        session.networkRetries = 0
        // A recheck after the base moved builds on this session's earlier update; keep its report.
        const previous = session.results.find(
          (result) => result.url === url && result.published && result.resolvedSha === pull.headSha,
        )
        this.saveResult(session, {
          url,
          number: pull.number,
          title: pull.title,
          headSha: previous?.headSha ?? pull.headSha,
          baseSha: pull.baseSha,
          resolvedSha,
          changedPaths: [
            ...new Set([
              ...(previous?.changedPaths ?? []),
              ...session.turns
                .filter((turn) => turn.url === url)
                .flatMap((turn) => turn.changedPaths),
            ]),
          ],
          rounds: (previous?.rounds ?? 0) + rounds,
          published: true,
        })
      }
      this.save(session)
    } finally {
      await workspace.close()
    }
    return () => workspace.verify(resolvedSha)
  }
  private saveResult(session: GandalfSession, result: GandalfSession['results'][number]) {
    session.results = session.results.filter((previous) => previous.url !== result.url)
    session.results.push(result)
  }
  private async roundRobin(request: {
    session: GandalfSession
    pull: PullRequest
    workspace: ConflictWorkspace
    signal: AbortSignal
  }) {
    const { session, pull, workspace, signal } = request
    const approvals = new Set<string>()
    for (let index = 0; index < MAX_GANDALF_TURNS; index++) {
      signal.throwIfAborted()
      const role = index % 2 === 0 ? 'primary' : 'secondary'
      this.progress(
        session,
        `${role === 'primary' ? 'Primary' : 'Secondary'} ${index ? 'reviewing and fixing' : 'resolving'} PR #${pull.number} · turn ${index + 1}…`,
      )
      const snapshot = await workspace.inspect()
      signal.throwIfAborted()
      const request: Parameters<typeof resolveWithGandalf>[0] = {
        pull,
        role,
        initial: index === 0,
        model: session[role === 'primary' ? 'primary' : 'companion'],
        workspace,
        snapshot,
        history: session.turns,
        signal,
      }
      const turn = await this.modelTurn(session.id, index, request)
      signal.throwIfAborted()
      await workspace.apply(turn.edits, turn.selections)
      const next = await workspace.inspect()
      const changed = snapshot.revision !== next.revision
      const approved = approvesTurn(turn, index, changed)
      if (changed || turn.edits.length || turn.selections.length) approvals.clear()
      if (approved) approvals.add(role)
      else approvals.delete(role)
      session.turns.push({
        url: pull.url,
        role,
        round: index + 1,
        summary: turn.summary,
        issues: turn.issues,
        approved,
        changedPaths: [
          ...turn.edits.map((edit) => edit.path),
          ...turn.selections.map((selection) => selection.path),
        ],
        revision: next.revision,
      })
      this.save(session)
      if (approvals.size === 2) return index + 1
    }
    throw new UserError(
      'The models have not agreed after 20 turns. Review their findings and retry; this PR was not updated.',
    )
  }
  private async modelTurn(
    sessionId: string,
    index: number,
    request: Parameters<typeof resolveWithGandalf>[0],
  ) {
    const execute = (observer?: import('../../../shared/domain/agentSession').ProviderObserver) =>
      (this.options.resolve ?? resolveWithGandalf)({ ...request, observer })
    return this.options.sessions
      ? await this.options.sessions.run(
          sessionId,
          {
            model: request.model,
            label: `${request.role} · turn ${index + 1}`,
            url: request.pull.url,
          },
          execute,
          request.signal,
        )
      : await execute()
  }
  private save(session: GandalfSession) {
    this.options.store.saveGandalfSession(session)
    this.options.sessions?.sync('gandalf', session)
  }
  private progress(session: GandalfSession, progress: string) {
    session.progress = progress
    this.save(session)
  }
}

function approvesTurn(turn: GandalfTurn, index: number, changed: boolean) {
  return (
    index > 0 &&
    !changed &&
    !turn.edits.length &&
    !turn.selections.length &&
    !turn.issues.length &&
    turn.approved
  )
}
