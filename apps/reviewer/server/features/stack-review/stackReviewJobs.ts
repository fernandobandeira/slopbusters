import { randomUUID } from 'node:crypto'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import {
  defaultPanelReviewers,
  seatRequests,
  type PanelSeatRequest,
} from '../../../shared/domain/panel'
import type { ModelPair, OrganizationPreferences } from '../../../shared/domain/preferences'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { stackPassInput } from '../../../shared/domain/stackPassInput'
import type { StackLayer, StackReviewSession } from '../../../shared/domain/stackReview'
import type { StackReviewSessionStore } from '../../adapters/stackReviewSessionStore'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { FlowJobs } from '../flows/flowJobs'
import { runCrossLayerPass } from './crossLayerPass'
import { layerRounds, runLayerPanels, type LayerPanels } from './layerPanels'
import { MAX_STACK_PASS_INPUT_CHARS, STACK_REVIEW_POLL_MS } from './limits'
import type { ResolvedLayer } from './stackResolution'

interface Options extends Omit<LayerPanels, 'pollMs'> {
  store: StackReviewSessionStore
  turns: StructuredTurns
  /** The open layers of a PR's stack, bottom to top; refuses a stack it cannot use. */
  resolve: (url: string, signal: AbortSignal) => Promise<ResolvedLayer[]>
  /** A layer's head and base as GitHub has them now. */
  revision: (url: string, signal: AbortSignal) => Promise<{ headSha: string; baseSha: string }>
  /** The panel's grounding judges, one per provider. */
  judges: () => Pick<ModelPair, 'primary'> & Partial<Pick<ModelPair, 'companion'>>
  sessions?: AgentSessions
  pollMs?: number
  /** The cross-layer pass's input budget, in characters. */
  budget?: number
}

/**
 * A whole-stack review: the panel on every open layer that has no up-to-date result, then a
 * cross-layer pass over every layer's grounded entries, ending in one stack brief. One stack
 * review per stack runs at a time; retry continues from the layers that finished.
 */
export class StackReviewJobs {
  private readonly jobs: FlowJobs<StackReviewSession>
  constructor(private readonly options: Options) {
    this.jobs = new FlowJobs({
      save: (session) => {
        this.save(session)
      },
      sessions: options.sessions,
      failure: {
        fallback: 'The stack review stopped on an unexpected error. Retry it.',
        progress: 'Stack review stopped. Panel results are saved.',
      },
    })
  }

  /** Review the stack `url` belongs to, or return the review already running on it. */
  async start(url: string, reviewers?: PanelSeatRequest[]): Promise<StackReviewSession> {
    const repository = repositoryOf(url)
    const layers = await this.options.resolve(url, new AbortController().signal)
    const urls = layers.map((layer) => layer.url)
    const previous = this.latest(repository, urls)
    if (previous?.status === 'running') {
      if (JSON.stringify(previous.urls) === JSON.stringify(urls)) return previous
      throw new UserError(
        'A stack review is already running on this stack. Wait for it or cancel it first.',
        409,
      )
    }
    const session: StackReviewSession = {
      id: randomUUID(),
      repository,
      url: layers.find((layer) => layer.number === parsePullUrl(url).number)?.url ?? url,
      urls,
      reviewers: reviewers ?? this.lastReviewers(repository, urls),
      status: 'running',
      progress: 'Reading each layer’s head…',
      createdAt: new Date().toISOString(),
      layers: layers.map((layer) => ({ ...layer, state: 'waiting' })),
    }
    this.options.sessions?.start(session.id, 'stack', session)
    this.save(session)
    this.launch(session, false)
    return session
  }
  get(id: string): StackReviewSession {
    const session = this.jobs.session(id) ?? this.options.store.get(id)
    if (!session) throw new UserError('This stack review is no longer available.', 404)
    return this.recover(session)
  }
  /** The newest stack review that covered any of `urls`. */
  latest(repository: string, urls: readonly string[]): StackReviewSession | undefined {
    const saved = this.options.store.latest(repository, urls)
    return saved && this.get(saved.id)
  }
  /** Run a stopped stack review again: the stack is read afresh and finished panels are kept. */
  retry(id: string): StackReviewSession {
    const session = this.get(id)
    if (session.status === 'running' || this.jobs.isRunning(id))
      throw new UserError('Wait for the stack review to stop before retrying it.')
    if (session.status === 'complete')
      throw new UserError('This stack review finished. Start another to review the stack again.')
    Object.assign(session, { status: 'running', error: undefined })
    this.progress(session, 'Retrying the stack review…')
    this.launch(session, true)
    return session
  }
  /** Stop the stack review. Panels it started keep working, and a retry reuses their results. */
  cancel(id: string): StackReviewSession {
    this.jobs.abort(id)
    const session = this.get(id)
    if (session.status === 'running' || session.status === 'partial') {
      session.status = 'cancelled'
      this.progress(
        session,
        'Stack review cancelled. Panels it started keep working; retry reuses their results.',
      )
    }
    return session
  }
  async close(): Promise<void> {
    await this.jobs.stop((session) => {
      this.cancel(session.id)
    })
  }

  private launch(session: StackReviewSession, retry: boolean) {
    this.jobs.launch(session, (signal) => this.run(session, signal, retry))
  }
  private async run(session: StackReviewSession, signal: AbortSignal, retry: boolean) {
    if (retry) await this.resolveAgain(session, signal)
    await this.readHeads(session, signal)
    this.progress(session, 'Running the panel on the layers without an up-to-date review…')
    const layers = { ...this.options, pollMs: this.options.pollMs ?? STACK_REVIEW_POLL_MS }
    await runLayerPanels(session, layers, {
      signal,
      retry,
      save: () => {
        this.save(session)
      },
    })
    const stopped = session.layers.filter((layer) => layer.state === 'stopped')
    if (stopped.length) {
      session.status = 'partial'
      session.error = stopped.map((layer) => layer.note ?? '').join('\n')
      this.progress(
        session,
        `${layerList(stopped)} stopped the stack review. Retry continues from there.`,
      )
      return
    }
    await this.readHeads(session, signal)
    await this.crossLayer(session, layerRounds(session, layers), signal)
    session.status = 'complete'
    this.progress(session, 'The stack brief is ready.')
  }
  /** Build the pass's input, keep a saved debate when the input is the same, and run the pass. */
  private async crossLayer(
    session: StackReviewSession,
    rounds: ReturnType<typeof layerRounds>,
    signal: AbortSignal,
  ) {
    const input = stackPassInput(rounds, this.options.budget ?? MAX_STACK_PASS_INPUT_CHARS)
    if (JSON.stringify(session.input) !== JSON.stringify(input)) {
      session.input = input
      session.pass = undefined
    }
    const judges = this.options.judges()
    session.pass ??= {
      roles: {
        primary: judges.primary,
        ...(judges.companion && judges.companion.provider !== judges.primary.provider
          ? { secondary: judges.companion }
          : {}),
      },
      turns: [],
      positions: {},
    }
    this.progress(session, 'Reading every layer’s findings together…')
    if (session.pass.outcome) return
    await runCrossLayerPass({
      turns: this.options.turns,
      signal,
      input,
      state: session.pass,
      stack: `${session.repository} #${String(session.layers[0]?.number ?? 0)}–#${String(session.layers.at(-1)?.number ?? 0)}`,
      save: () => {
        this.save(session)
      },
      track: (pass, execute) => this.track(session, pass, execute),
    })
  }
  private async resolveAgain(session: StackReviewSession, signal: AbortSignal) {
    this.progress(session, 'Reading the stack again…')
    const layers = await this.options.resolve(session.url, signal)
    session.urls = layers.map((layer) => layer.url)
    session.layers = layers.map((layer) => ({ ...layer, state: 'waiting' }))
    this.save(session)
  }
  private async readHeads(session: StackReviewSession, signal: AbortSignal) {
    for (const layer of session.layers) {
      const { headSha, baseSha } = await this.options.revision(layer.url, signal)
      signal.throwIfAborted()
      Object.assign(layer, { headSha, baseSha })
    }
    this.save(session)
  }
  /** The seats of the newest panel on any layer, else the default panel. */
  private lastReviewers(repository: string, urls: readonly string[]): PanelSeatRequest[] {
    const newest = urls
      .flatMap((url) => this.options.panels.latest(repository, url) ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return newest
      ? seatRequests(newest.reviewers, newest.model.provider)
      : [...defaultPanelReviewers]
  }
  private recover(session: StackReviewSession): StackReviewSession {
    return this.jobs.recover(
      session,
      'Stack review interrupted when the app stopped. Retry it; panel results are saved.',
    )
  }
  private track<T>(
    session: StackReviewSession,
    pass: { label: string; model: OrganizationPreferences },
    execute: (observer?: ProviderObserver) => Promise<T>,
  ): Promise<T> {
    return this.options.sessions
      ? this.options.sessions.run(session.id, { ...pass, url: session.url }, execute)
      : execute()
  }
  private save(session: StackReviewSession) {
    this.options.store.save(session)
    this.options.sessions?.sync('stack', session)
  }
  private progress(session: StackReviewSession, progress: string) {
    this.jobs.progress(session, progress)
  }
}

function repositoryOf(url: string): string {
  const { owner, repo } = parsePullUrl(url)
  return `${owner}/${repo}`
}

function layerList(layers: readonly StackLayer[]): string {
  return layers.map((layer) => `PR #${String(layer.number)}`).join(', ')
}
