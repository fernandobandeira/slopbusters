import { randomUUID } from 'node:crypto'
import { workerReportSchema, type LayerFixSession } from '../../../shared/domain/layerFix'
import type { ModelPair } from '../../../shared/domain/preferences'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { Provider } from '../../../shared/domain/types'
import type { StackReviewSession } from '../../../shared/domain/stackReview'
import type { LayerFixStore } from '../../adapters/layerFixStore'
import type { FixWorktree } from '../../adapters/fixWorktrees'
import type { ChatWorkspace } from '../../adapters/t3Engine/chatHosts'
import type { ThreadTurns } from '../../adapters/t3Engine/threadTurns'
import { LAYER_FIX_TIMEOUT_MS } from '../../limits'
import { UserError } from '../../errors'
import { FlowJobs } from '../flows/flowJobs'
import { remoteMovement, reportProblems } from './verification'
import { workerSeed } from './seed'

interface Options {
  store: Pick<LayerFixStore, 'save' | 'get' | 'all'>
  stack: (id: string) => StackReviewSession
  models: () => ModelPair
  workspace: (repository: { owner: string; repo: string }) => Promise<ChatWorkspace>
  turns: ThreadTurns
  prepare: (checkout: string, url: string, sha: string, run: string) => Promise<FixWorktree>
  instructions: (path: string, seed: string) => Promise<string>
  preventPush: (checkout: string) => Promise<void>
  head: (path: string, start: string) => Promise<string>
  tip: (path: string) => Promise<string>
  commits: (path: string, start: string, head: string) => Promise<string[]>
  revision: (url: string) => Promise<{ headSha: string; baseSha: string }>
  check: (session: LayerFixSession, signal: AbortSignal) => Promise<LayerFixSession['results']>
}

/** One worker per stack. Owns its retained worktree, cancellation and interrupted recovery. */
export class LayerFixJobs {
  private readonly jobs: FlowJobs<LayerFixSession>
  constructor(private readonly options: Options) {
    this.jobs = new FlowJobs({
      save: (session) => {
        if (session.status === 'failed') session.outcome ??= 'stopped'
        options.store.save(session)
      },
      failure: {
        fallback: 'The fix worker stopped unexpectedly. Its worktree is preserved.',
        progress: 'Fix worker stopped.',
      },
    })
  }

  start(stackId: string, url: string, selected?: readonly string[]): LayerFixSession {
    const stack = this.options.stack(stackId)
    const group = stackBrief(stack)?.fixes.find((item) => item.layer.url === url)
    if (!group || !group.layer.current || !group.layer.reviewedHead)
      throw new UserError('This layer is no longer current; review it again.')
    this.requireIdle(stack.urls)
    const chosen = selected ? group.items.filter((item) => selected.includes(item.id)) : group.items
    if (!chosen.length || (selected && new Set(selected).size !== chosen.length))
      throw new UserError('Choose fixes from this layer’s brief.')
    const models = this.options.models()
    if (models.primary.provider === models.companion.provider)
      throw new UserError('The fix worker needs a checker from the other provider.')
    const session: LayerFixSession = {
      id: randomUUID(),
      stack: stackId,
      urls: stack.urls,
      url,
      start: group.layer.reviewedHead,
      base: group.layer.reviewedBase ?? '',
      createdAt: new Date().toISOString(),
      model: models.primary,
      checker: models.companion,
      status: 'running',
      progress: 'Preparing an app-owned worktree…',
      fixes: chosen.map((fix) => ({
        ...fix,
        reason: stack.input?.entries.find((item) => item.id === fix.id)?.reason ?? fix.triage,
      })),
      correctionUsed: false,
      commands: [],
      commits: [],
      results: [],
      left: [],
    }
    // Reserve synchronously before the first await so simultaneous starts cannot race.
    this.options.store.save(session)
    this.jobs.launch(session, (signal) => this.run(session, signal))
    return session
  }

  get(id: string): LayerFixSession {
    const session = this.jobs.session(id) ?? this.options.store.get(id)
    if (!session) throw new UserError('This fix run is no longer available.', 404)
    this.jobs.recover(
      session,
      'Fix worker interrupted when the app stopped. The worktree is preserved.',
    )
    if (session.status === 'cancelled' && !session.outcome) {
      session.outcome = 'interrupted'
      this.options.store.save(session)
    }
    return session
  }
  latest(url: string): LayerFixSession | undefined {
    const session = this.options.store.all().find((item) => item.url === url)
    return session && this.get(session.id)
  }
  async retry(id: string): Promise<LayerFixSession> {
    const session = this.get(id)
    if (session.status === 'running' || this.jobs.isRunning(id))
      throw new UserError('Wait for the fix worker to stop.')
    if (session.outcome === 'done' || session.outcome === 'pushed' || session.outcome === 'moved')
      throw new UserError('Review this layer again before starting another fix run.')
    this.requireIdle(session.urls)
    if (session.worktree) await this.options.head(session.worktree.path, session.start)
    this.requireIdle(session.urls)
    session.status = 'running'
    session.outcome = undefined
    session.error = undefined
    this.options.store.save(session)
    this.jobs.launch(session, (signal) => this.run(session, signal))
    return session
  }
  cancel(id: string): LayerFixSession {
    const session = this.get(id)
    this.jobs.abort(id)
    session.status = 'cancelled'
    session.outcome = 'stopped'
    this.jobs.progress(session, 'Fix worker cancelled. The worktree is preserved.')
    return session
  }
  async open(id: string): Promise<void> {
    const session = this.get(id)
    if (!session.thread) throw new UserError('The fix thread has not started yet.')
    const workspace = await this.options.workspace(parsePullUrl(session.url))
    await workspace.open(session.thread.threadId)
  }
  async close(): Promise<void> {
    await this.jobs.stop((session) => {
      this.jobs.abort(session.id)
    })
  }

  private requireIdle(urls: readonly string[]) {
    for (const saved of this.options.store.all()) {
      const session = this.get(saved.id)
      if (session.status === 'running' && session.urls.some((url) => urls.includes(url)))
        throw new UserError('A fix worker is already running on this stack.', 409)
    }
  }
  private async run(session: LayerFixSession, signal: AbortSignal) {
    if (!(await this.current(session))) return
    const workspace = await this.options.workspace(parsePullUrl(session.url))
    await this.options.preventPush(workspace.project.workspaceRoot)
    session.worktree ??= await this.options.prepare(
      workspace.project.workspaceRoot,
      session.url,
      session.start,
      session.id,
    )
    this.options.store.save(session)
    const head = await this.options.head(session.worktree.path, session.start)
    signal.throwIfAborted()
    const message = await this.options.instructions(
      session.worktree.path,
      workerSeed(session, head),
    )
    const model = {
      instanceId: session.model.provider === Provider.claude ? 'claudeAgent' : 'codex',
      model: session.model.model,
    }
    const first = !session.thread
    if (!session.thread) {
      session.thread = await workspace.threads.startThread({
        threadId: session.id,
        messageId: randomUUID(),
        projectId: workspace.project.id,
        title: 'Slopbusters · Apply layer fixes',
        model,
        message,
        branch: session.worktree.branch,
        worktreePath: session.worktree.path,
      })
      this.options.store.save(session)
    }
    try {
      await this.converse(session, signal, model, { message, first })
    } catch (error) {
      if (session.outcome !== 'pushed' && session.outcome !== 'moved') throw error
      // Remote movement has already saved a stop reason; it must not become a generic failure.
    }
  }
  private async converse(
    session: LayerFixSession,
    signal: AbortSignal,
    model: { instanceId: string; model: string },
    { message, first }: { message: string; first: boolean },
  ) {
    if (!session.thread || !session.worktree) throw new Error('Missing worker thread.')
    this.jobs.progress(session, 'Applying fixes and observing repository checks…')
    const turn = await this.options.turns.run({
      thread: session.thread,
      model,
      message,
      first,
      signal,
      schema: workerReportSchema,
      timeoutMs: LAYER_FIX_TIMEOUT_MS,
      settled: async (turn) => {
        session.commands = [...turn.commands]
        this.options.store.save(session)
        if (!(await this.current(session)))
          throw new UserError('The remote layer moved; the fix worker stopped.')
      },
    })
    if (signal.aborted) {
      session.status = 'cancelled'
      session.outcome ??= 'interrupted'
      this.options.store.save(session)
      return
    }
    session.commands = [...turn.commands]
    session.report = turn.report
    if (turn.outcome.status !== 'completed' || turn.error) {
      this.stop(
        session,
        turn.error ?? `The worker turn ended as ${turn.outcome.status}.`,
        'stopped',
      )
      return
    }
    this.jobs.progress(session, 'Verifying commits and checking the plans with the other provider…')
    session.head = await this.options.head(session.worktree.path, session.start)
    session.commits = await this.options.commits(session.worktree.path, session.start, session.head)
    session.results = await this.options.check(session, signal)
    signal.throwIfAborted()
    if (!(await this.current(session))) return
    const problems = reportProblems(session)
    session.left = [
      ...session.fixes
        .filter((fix) => fix.field)
        .map((fix) => `${fix.id}: ${fix.field ?? ''}: ${fix.title} — left for the author`),
      ...problems,
    ]
    if (problems.length && !session.correctionUsed) {
      session.correctionUsed = true
      this.options.store.save(session)
      await this.converse(session, signal, model, {
        message: `One correction round. Fix these verification problems, rerun all repository checks, and return a complete JSON report for all selected code fixes:\n${problems.join('\n')}`,
        first: false,
      })
      return
    }
    session.status = problems.length ? 'partial' : 'complete'
    session.outcome = problems.length ? 'needs-you' : 'done'
    this.jobs.progress(
      session,
      problems.length ? 'Fixes need your attention.' : 'Fixes committed locally. Nothing pushed.',
    )
  }
  private async current(session: LayerFixSession): Promise<boolean> {
    const remote = await this.options.revision(session.url)
    const tip = session.worktree ? await this.options.tip(session.worktree.path) : session.start
    const movement = remoteMovement(session.start, remote.headSha, tip)
    if (movement) {
      this.stop(session, `The remote layer ${movement}. Review it again.`, movement)
      return false
    }
    if (remote.baseSha !== session.base) {
      this.stop(session, 'The layer base moved; review it again.', 'moved')
      return false
    }
    return true
  }
  private stop(session: LayerFixSession, reason: string, outcome: 'stopped' | 'pushed' | 'moved') {
    session.status = 'cancelled'
    session.outcome = outcome
    this.jobs.progress(session, reason)
  }
}
