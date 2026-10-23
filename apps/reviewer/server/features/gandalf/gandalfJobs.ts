import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { GandalfSession, GandalfTask, GandalfTurn } from '../../../shared/domain/gandalf'
import { savedModels } from '../models'
import type { PullRequest } from '../../../shared/domain/types'
import type { ReviewerStore } from '../../adapters/store'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import type { ConflictWorkspace } from '../../adapters/conflictWorkspace'
import { BaseAdvancedError } from '../../adapters/conflictRevision'
import type { CiFailure } from '../../adapters/ciFailures'
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
import { debate, unanimousApproval, type DebateMove } from '../flows/debate'
import { FlowJobs } from '../flows/flowJobs'
import { resolveWithGandalf } from './gandalfResolution'
import { completion, publishedResult, saveResult, unchangedResult } from './gandalfResults'

interface Options {
  store: ReviewerStore
  turns: StructuredTurns
  sessions?: AgentSessions
  loadPull: (url: string) => Promise<PullRequest>
  openWorkspace: (
    pull: PullRequest,
    signal: AbortSignal,
    task: GandalfTask,
  ) => Promise<ConflictWorkspace>
  loadFailures?: (pull: PullRequest, signal: AbortSignal) => Promise<CiFailure[]>
  plan?: (urls: string[], signal: AbortSignal) => Promise<string[]>
  /** Replaces the model turn, which otherwise runs `resolveWithGandalf` on `turns`. */
  resolve?: typeof resolveWithGandalf
  networkRetryDelaysMs?: readonly number[]
}

const roles = ['primary', 'secondary'] as const

/**
 * Gandalf resolves each PR of a stack with a debate between the two models on one workspace,
 * publishing a PR once both approve it unchanged.
 */
export class GandalfJobs {
  private readonly jobs: FlowJobs<GandalfSession>
  private suspended = false
  constructor(private options: Options) {
    this.jobs = new FlowJobs({
      save: (session) => {
        this.save(session)
      },
      sessions: options.sessions,
      failure: {
        fallback: 'Gandalf stopped on an unexpected error. Retry the remaining PRs.',
        progress: 'Resolution stopped. Completed PR updates are saved.',
      },
    })
  }

  start(repository: string, urls: string[], task: GandalfTask = 'conflicts'): GandalfSession {
    this.requireAwake()
    const previous = this.latest(repository)
    if (previous?.status === 'running') {
      if (previous.task === task && JSON.stringify(previous.urls) === JSON.stringify(urls))
        return previous
      throw new UserError('Finish or cancel the current Gandalf session first.')
    }
    if (this.busy(repository))
      throw new UserError('Wait for the previous Gandalf session to stop before starting another.')
    const session: GandalfSession = {
      id: randomUUID(),
      repository,
      task,
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
    if (this.busy(session.repository))
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
    const session = this.jobs.session(id) ?? this.get(id)
    if (session.status === 'running') {
      session.status = 'cancelled'
      session.progress = 'Resolution cancelled. Completed PR updates are saved.'
      this.save(session)
    }
    this.jobs.abort(id)
    return session
  }
  async suspend() {
    this.suspended = true
    await this.jobs.stop((session) => {
      this.jobs.abort(session.id)
      if (session.status === 'running')
        this.progress(session, 'Resolution paused. It will resume when the app is awake.')
    })
  }
  async resume() {
    this.suspended = false
    await this.jobs.settleAborted()
    if (!this.isAwake()) return
    for (const session of this.options.store.pendingGandalfSessions()) {
      if (this.busy(session.repository)) continue
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
  private busy(repository: string) {
    return this.jobs.active().some((session) => session.repository === repository)
  }
  private models() {
    return savedModels(this.options.store.getPreferences())
  }
  private launch(session: GandalfSession) {
    this.jobs.launch(session, (signal) => this.runWithRecovery(session, signal))
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
    const stackBranches = new Set<string>()
    for (const url of session.urls) {
      signal.throwIfAborted()
      verifications.push(await this.resolvePull(session, url, stackBranches, signal))
    }
    signal.throwIfAborted()
    this.progress(session, 'Verifying all updated branches…')
    for (const verify of verifications) {
      signal.throwIfAborted()
      await verify()
    }
    signal.throwIfAborted()
    session.status = 'complete'
    this.progress(session, completion(session))
  }
  /** Stack branches processed earlier in this run; their children merge any update to them. */
  private async resolvePull(
    session: GandalfSession,
    url: string,
    stackBranches: Set<string>,
    signal: AbortSignal,
  ) {
    const { workspace, failures } = await this.prepare(session, url, signal)
    const pull = workspace.pull
    let resolvedSha = pull.headSha
    try {
      stackBranches.add(pull.headBranch)
      // CI fixes only update a base for failing PRs and for stack layers above a processed parent.
      const needsWork =
        session.task === 'ci'
          ? failures.length > 0 || (workspace.needsUpdate && stackBranches.has(pull.baseBranch))
          : workspace.needsUpdate
      if (!needsWork) {
        await workspace.verify()
        saveResult(session, unchangedResult(session, url, pull))
      } else {
        // Old attempts are not evidence for this freshly fetched revision.
        session.turns = session.turns.filter((turn) => turn.url !== url)
        const rounds = await this.roundRobin({ session, pull, workspace, failures, signal })
        signal.throwIfAborted()
        this.progress(session, `Both models agree. Updating PR #${pull.number}…`)
        resolvedSha = await workspace.publish()
        // Published progress earns a fresh budget for later connection drops.
        session.networkRetries = 0
        saveResult(session, publishedResult(session, url, pull, { resolvedSha, rounds }))
      }
      this.save(session)
    } finally {
      await workspace.close()
    }
    return () => workspace.verify(resolvedSha)
  }
  private async prepare(session: GandalfSession, url: string, signal: AbortSignal) {
    this.progress(session, `Loading ${url}…`)
    const loaded = await this.options.loadPull(url)
    signal.throwIfAborted()
    if (loaded.state !== 'open') throw new UserError('Select open PRs for Gandalf.')
    this.progress(
      session,
      session.task === 'ci'
        ? `Preparing PR #${loaded.number} and its failing checks…`
        : `Preparing conflicts for PR #${loaded.number}…`,
    )
    const workspace = await this.options.openWorkspace(loaded, signal, session.task)
    try {
      signal.throwIfAborted()
      const failures =
        session.task === 'ci'
          ? ((await this.options.loadFailures?.(workspace.pull, signal)) ?? [])
          : []
      signal.throwIfAborted()
      return { workspace, failures }
    } catch (error) {
      await workspace.close()
      throw error
    }
  }
  /** The two models take turns on the workspace until both approve it unchanged. */
  private roundRobin(request: Debate) {
    return debate({
      roles,
      maxTurns: MAX_GANDALF_TURNS,
      signal: request.signal,
      consensus: unanimousApproval(roles),
      turn: (role, index) => this.takeTurn(request, role, index),
      stalled: () =>
        new UserError(
          'The models have not agreed after 20 turns. Review their findings and retry; this PR was not updated.',
        ),
    })
  }
  /** One model's turn: inspect, edit or approve, and record it in the session's trail. */
  private async takeTurn(
    { session, pull, workspace, failures, signal }: Debate,
    role: (typeof roles)[number],
    index: number,
  ): Promise<DebateMove> {
    this.progress(
      session,
      `${role === 'primary' ? 'Primary' : 'Secondary'} ${index ? 'reviewing and fixing' : session.task === 'ci' ? 'fixing CI for' : 'resolving'} PR #${pull.number} · turn ${index + 1}…`,
    )
    const snapshot = await workspace.inspect()
    signal.throwIfAborted()
    const request: Parameters<typeof resolveWithGandalf>[0] = {
      turns: this.options.turns,
      pull,
      task: session.task,
      role,
      initial: index === 0,
      model: session[role === 'primary' ? 'primary' : 'companion'],
      workspace,
      snapshot,
      failures,
      history: session.turns,
      signal,
    }
    const turn = await this.modelTurn(session.id, index, request)
    signal.throwIfAborted()
    await workspace.apply(turn.edits, turn.selections)
    const next = await workspace.inspect()
    const changed = snapshot.revision !== next.revision
    const approved = approvesTurn(turn, index, changed)
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
    return { changed: changed || turn.edits.length > 0 || turn.selections.length > 0, approved }
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
    this.jobs.progress(session, progress)
  }
}

interface Debate {
  session: GandalfSession
  pull: PullRequest
  workspace: ConflictWorkspace
  failures: CiFailure[]
  signal: AbortSignal
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
