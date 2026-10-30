import { randomUUID } from 'node:crypto'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { LinusAdvice } from '../../../shared/domain/linus'
import {
  sameCut,
  type SplitLayer,
  type SplitLayerPlan,
  type SplitSession,
} from '../../../shared/domain/split'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitIdentity } from '../../adapters/gitIdentity'
import { LayerBuildError, type SplitWorkspace } from '../../adapters/splitWorkspace'
import type { ReviewerStore } from '../../adapters/store'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import { MAX_SPLIT_TURNS } from './limits'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { debate, unanimousApproval, type DebateMove } from '../flows/debate'
import { FlowJobs } from '../flows/flowJobs'
import { savedModels } from '../models'
import type { SplitPulls } from './splitPulls'
import { cutWithLinus } from './splitTurns'

interface Options {
  store: ReviewerStore
  turns: StructuredTurns
  sessions?: AgentSessions
  skill: () => Promise<string>
  loadPull: (url: string) => Promise<PullRequest>
  openWorkspace: (pull: PullRequest, signal: AbortSignal) => Promise<SplitWorkspace>
  identity: (signal: AbortSignal) => Promise<GitIdentity>
  pulls: SplitPulls
  /** Replaces the model turn, which otherwise runs `cutWithLinus` on `turns`. */
  cut?: typeof cutWithLinus
}

/** What the author asks for with a split beyond the PR itself. */
export interface SplitStartOptions {
  plan?: LinusAdvice['layers']
  guidance?: string
  linusSessionId?: string
}

const roles = ['primary', 'secondary'] as const

/**
 * Linus splits one PR into a stack: the two models take turns cutting and reviewing the layers,
 * each cut built from the merge base and checked to add up to the PR head, until both approve
 * the same cut. Then every layer's branch is pushed and its PR opened on the layer below.
 */
export class SplitJobs {
  private readonly jobs: FlowJobs<SplitSession>
  constructor(private readonly options: Options) {
    this.jobs = new FlowJobs({
      save: (session) => {
        this.save(session)
      },
      sessions: options.sessions,
      failure: {
        fallback: 'The split stopped on an unexpected error. Retry it.',
        progress: 'Split stopped. Nothing was published.',
      },
    })
  }

  start(repository: string, url: string, options: SplitStartOptions = {}): SplitSession {
    const previous = this.latest(repository, url)
    if (previous?.status === 'running') return previous
    if (this.jobs.active().some((session) => session.repository === repository))
      throw new UserError('Wait for the current split in this repository to finish first.')
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1])
    if (!number) throw new UserError('Choose a PR to split.')
    const session: SplitSession = {
      id: randomUUID(),
      repository,
      url,
      number,
      title: '',
      description: '',
      headBranch: '',
      baseBranch: '',
      headSha: '',
      baseSha: '',
      ...savedModels(this.options.store.getPreferences()),
      status: 'running',
      progress: 'Reading the PR and its diff…',
      createdAt: new Date().toISOString(),
      ...(options.linusSessionId ? { linusSessionId: options.linusSessionId } : {}),
      plan: options.plan ?? [],
      ...(options.guidance ? { guidance: options.guidance } : {}),
      units: [],
      turns: [],
      layers: [],
    }
    this.options.sessions?.start(session.id, 'split', { ...session, urls: [url] })
    this.save(session)
    this.launch(session)
    return session
  }
  get(id: string): SplitSession {
    const session = this.jobs.session(id) ?? this.options.store.getSplitSession(id)
    if (!session) throw new UserError('This split is no longer available.', 404)
    return this.jobs.recover(session, 'Split interrupted when the app stopped. Retry it.')
  }
  latest(repository: string, url?: string): SplitSession | undefined {
    const session = this.options.store.latestSplitSession(repository, url)
    return (
      session && this.jobs.recover(session, 'Split interrupted when the app stopped. Retry it.')
    )
  }
  retry(id: string): SplitSession {
    const session = this.get(id)
    if (session.status === 'running' || this.jobs.isRunning(id))
      throw new UserError('Wait for the current split to stop before retrying.')
    Object.assign(session, savedModels(this.options.store.getPreferences()), {
      status: 'running',
      error: undefined,
      failureContext: undefined,
      progress: 'Reading the PR and its diff again…',
    })
    this.save(session)
    this.launch(session)
    return session
  }
  cancel(id: string): SplitSession {
    const session = this.get(id)
    if (session.status === 'running') {
      session.status = 'cancelled'
      session.progress = 'Split cancelled. Nothing more was published.'
      this.save(session)
    }
    this.jobs.abort(id)
    return session
  }
  async close() {
    await this.jobs.stop((session) => this.cancel(session.id))
  }

  private launch(session: SplitSession) {
    this.jobs.launch(session, async (signal) => {
      try {
        await this.run(session, signal)
      } catch (cause) {
        if (signal.aborted) return
        session.failureContext = session.progress
        throw cause
      }
    })
  }
  private async run(session: SplitSession, signal: AbortSignal) {
    const loaded = await this.options.loadPull(session.url)
    if (loaded.state !== 'open') throw new UserError('Only an open PR can be split.')
    signal.throwIfAborted()
    const workspace = await this.options.openWorkspace(loaded, signal)
    try {
      const { pull } = workspace
      const moved = session.headSha && session.headSha !== pull.headSha
      Object.assign(session, {
        title: pull.title,
        description: pull.description,
        headBranch: pull.headBranch,
        baseBranch: pull.baseBranch,
        headSha: pull.headSha,
        baseSha: workspace.baseSha,
        units: workspace.units,
      })
      if (moved) {
        // Earlier cuts named units of a diff that no longer exists.
        session.turns = []
        session.layers = []
        session.verified = false
      }
      this.save(session)
      const skill = await this.options.skill()
      const identity = await this.options.identity(signal)
      signal.throwIfAborted()
      await this.agree({ session, workspace, skill, identity, signal })
      signal.throwIfAborted()
      await this.publish(session, workspace, signal)
      session.status = 'complete'
      this.progress(
        session,
        `Split PR #${String(session.number)} into ${String(session.layers.length)} PRs. Every layer builds on the one below, and the stack adds up to the original PR.`,
      )
    } finally {
      await workspace.close()
    }
  }
  /** The two models take turns until both approve the same built cut. */
  private async agree(context: Context) {
    const { session, signal } = context
    const history = session.turns.map((turn) => ({
      role: turn.role,
      move: { changed: turn.changed, approved: turn.approved },
    }))
    if (history.length && session.verified)
      // Replayed turns from an interrupted run; the cut they approved is rebuilt first.
      await this.rebuild(context)
    else {
      session.turns = []
      session.layers = []
      session.verified = false
    }
    await debate({
      roles,
      maxTurns: MAX_SPLIT_TURNS,
      signal,
      consensus: unanimousApproval(roles),
      history: session.verified ? history : [],
      turn: (role, index) => this.takeTurn(context, role, index),
      stalled: () =>
        new UserError(
          `The models have not agreed on a cut after ${String(MAX_SPLIT_TURNS)} turns. Review their turns and retry, or split the PR in T3 Code.`,
        ),
    })
  }
  private async rebuild(context: Context) {
    const { session, workspace, identity } = context
    try {
      session.layers = await workspace.build(session.layers, identity)
    } catch (cause) {
      if (!(cause instanceof LayerBuildError)) throw cause
      session.turns = []
      session.layers = []
      session.verified = false
    }
  }
  private async takeTurn(context: Context, role: Role, index: number): Promise<DebateMove> {
    const { session, workspace, signal } = context
    this.progress(
      session,
      `${role === 'primary' ? 'Primary' : 'Secondary'} model ${index ? 'reviewing the cut' : 'cutting the stack'} · turn ${String(index + 1)}…`,
    )
    const before = JSON.stringify(session.layers)
    const request: Parameters<typeof cutWithLinus>[0] = {
      turns: this.options.turns,
      session,
      skill: context.skill,
      role,
      initial: index === 0,
      model: session[role === 'primary' ? 'primary' : 'companion'],
      directory: workspace.directory,
      units: workspace.units,
      patch: workspace.patch,
      tryCut: (layers) => this.tryCut(context, layers),
      signal,
    }
    const turn = await this.modelTurn(session.id, index, request)
    signal.throwIfAborted()
    const changed = JSON.stringify(session.layers) !== before
    const approved =
      index > 0 && !changed && turn.approved && !turn.issues.length && session.layers.length > 0
    session.turns.push({
      role,
      round: index + 1,
      summary: turn.summary,
      issues: turn.issues,
      approved,
      changed,
    })
    this.save(session)
    return { changed, approved }
  }
  /** Build a proposed cut; the layers stay when it builds, and the reason returns when not. */
  private async tryCut(context: Context, layers: SplitLayerPlan[]): Promise<string | undefined> {
    const { session, workspace, identity } = context
    if (sameCut(layers, session.layers) && sameWords(layers, session.layers)) return undefined
    try {
      session.layers = await workspace.build(layers, identity)
      session.verified = true
      this.save(session)
      return undefined
    } catch (cause) {
      if (!(cause instanceof LayerBuildError)) throw cause
      return `${cause.message}\nRevise the cut so every layer applies on the one below.`
    }
  }
  private async modelTurn(
    sessionId: string,
    index: number,
    request: Parameters<typeof cutWithLinus>[0],
  ) {
    const execute = (observer?: ProviderObserver) =>
      (this.options.cut ?? cutWithLinus)({ ...request, observer })
    return this.options.sessions
      ? await this.options.sessions.run(
          sessionId,
          {
            model: request.model,
            label: `${request.role} · turn ${String(index + 1)}`,
            url: request.session.url,
          },
          execute,
          request.signal,
        )
      : await execute()
  }
  /** Push every branch, open each PR on the layer below, then write the stack into each body. */
  private async publish(session: SplitSession, workspace: SplitWorkspace, signal: AbortSignal) {
    const { pulls } = this.options
    const repository = { owner: workspace.pull.owner, repo: workspace.pull.repo }
    this.progress(session, `Both models agree. Pushing ${String(session.layers.length)} branches…`)
    await workspace.publish(
      session.layers,
      session.layers.filter((layer) => layer.pullUrl),
    )
    signal.throwIfAborted()
    for (const [index, layer] of session.layers.entries()) {
      this.progress(
        session,
        `Opening the PR for layer ${String(index + 1)} of ${String(session.layers.length)}…`,
      )
      const base = index === 0 ? session.baseBranch : (session.layers[index - 1]?.branch ?? '')
      if (layer.pullNumber) {
        await pulls.update(repository, layer.pullNumber, { title: layer.title, base }, signal)
        continue
      }
      const created = await pulls.create(
        repository,
        { title: layer.title, body: layer.description, head: layer.branch, base, draft: true },
        signal,
      )
      layer.pullUrl = created.url
      layer.pullNumber = created.number
      this.save(session)
      signal.throwIfAborted()
    }
    for (const layer of session.layers) {
      if (!layer.pullNumber) continue
      await pulls.update(repository, layer.pullNumber, { body: stackBody(session, layer) }, signal)
    }
    session.published = true
    this.save(session)
  }
  private save(session: SplitSession) {
    this.options.store.saveSplitSession(session)
    this.options.sessions?.sync('split', { ...session, urls: [session.url] })
  }
  private progress(session: SplitSession, progress: string) {
    this.jobs.progress(session, progress)
  }
}

type Role = (typeof roles)[number]
interface Context {
  session: SplitSession
  workspace: SplitWorkspace
  skill: string
  identity: GitIdentity
  signal: AbortSignal
}

/** Whether two cuts also carry the same titles and descriptions. */
function sameWords(left: readonly SplitLayerPlan[], right: readonly SplitLayer[]): boolean {
  return left.every((layer, index) => {
    const built = right[index]
    return (
      built !== undefined && layer.title === built.title && layer.description === built.description
    )
  })
}

/** A layer's PR body: its description, then where it sits in the stack. */
export function stackBody(session: SplitSession, layer: SplitLayer): string {
  const list = session.layers
    .map((item, index) => {
      const reference = item.pullNumber ? `#${String(item.pullNumber)}` : item.branch
      const marker = item === layer ? ' ← this PR' : ''
      return `${String(index + 1)}. ${reference} ${item.title}${marker}`
    })
    .join('\n')
  return `${layer.description.trim()}\n\n---\n\nStack split from #${String(session.number)}, bottom to top; each layer builds on the one below and the stack adds up to the original PR:\n\n${list}`
}
