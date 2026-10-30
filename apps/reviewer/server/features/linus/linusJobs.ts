import {
  panelProceeds,
  type LinusAdvice,
  type LinusResult,
  type LinusSession,
  type LinusThenPanel,
} from '../../../shared/domain/linus'
import type { PanelSession } from '../../../shared/domain/panelSession'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import { savedModels } from '../models'
import { fetchPull } from '../pulls/github'
import { publicError, UserError } from '../../errors'
import { loadLinusSkill, reconcileWithLinus, reviewWithLinus } from './linusReview'
import { DualReviewJobs, type DualReviewDependencies } from '../dualReviewJobs'

/** The panel Linus hands a PR on to; only what starting one needs. */
export interface LinusPanels {
  start: (
    repository: string,
    urls: string[],
    reviewers: PanelSeatRequest[],
  ) => Promise<PanelSession>
}

/** What the author asks for with a Linus review beyond the PRs themselves. */
export interface LinusStartOptions {
  thenPanel?: LinusThenPanel
  guidance?: string
}

export class LinusJobs extends DualReviewJobs<LinusAdvice, LinusSession> {
  private readonly panels?: LinusPanels
  constructor(options: DualReviewDependencies & { panels?: LinusPanels }) {
    const { store, turns, staticDirectory, skillDirectory, loadPull = fetchPull } = options
    super({
      name: 'Linus',
      kind: 'linus',
      sessions: options.sessions,
      models: () => savedModels(store.getPreferences()),
      skill: () => loadLinusSkill(staticDirectory, skillDirectory),
      save: (session) => {
        store.linus.save(session)
      },
      get: (id) => store.linus.get(id),
      latest: (repository) => store.linus.latest(repository),
      loadPull,
      openRepository: options.openRepository,
      context: options.context,
      review: (request) => reviewWithLinus({ ...request, turns }),
      reconcile: (request) => reconcileWithLinus({ ...request, turns }),
      onResult: (session, result) => this.sendOn(session, result),
    })
    this.panels = options.panels
  }

  override start(
    repository: string,
    urls: string[],
    options: LinusStartOptions = {},
  ): LinusSession {
    if (options.thenPanel && !this.panels)
      throw new UserError('The review panel is not available here.')
    return super.start(repository, urls, {
      ...(options.thenPanel ? { thenPanel: options.thenPanel } : {}),
      ...(options.guidance ? { guidance: options.guidance } : {}),
    })
  }

  /** Start the panel on a reviewed PR whatever Linus said, as the author decided. */
  async startPanel(id: string, url: string): Promise<LinusSession> {
    const session = this.get(id)
    const result = session.results.find((item) => item.pull.url === url)
    if (!session.thenPanel || !result)
      throw new UserError('Linus was not asked to send this PR on to the panel.')
    if (result.panelSessionId) return session
    await this.startPanelFor(session, result, session.thenPanel)
    this.saveSession(session)
    if (result.panelError) throw new UserError(result.panelError)
    return session
  }

  /** Remember the split started from this PR's layers, so its review can open it. */
  recordSplit(id: string, url: string, splitSessionId: string): LinusSession {
    const session = this.get(id)
    const result = session.results.find((item) => item.pull.url === url)
    if (!result) throw new UserError('Linus did not review this PR in that session.')
    result.splitSessionId = splitSessionId
    this.saveSession(session)
    return session
  }

  /** A PR Linus would keep as one goes on to the panel; one he would split waits for the author. */
  private async sendOn(session: LinusSession, result: LinusResult): Promise<void> {
    if (!session.thenPanel || !panelProceeds(result.advice)) return
    await this.startPanelFor(session, result, session.thenPanel)
  }

  private async startPanelFor(
    session: LinusSession,
    result: LinusResult,
    thenPanel: LinusThenPanel,
  ): Promise<void> {
    if (!this.panels) {
      result.panelError = 'The review panel is not available here.'
      return
    }
    try {
      const panel = await this.panels.start(
        session.repository,
        [result.pull.url],
        thenPanel.reviewers,
      )
      result.panelSessionId = panel.id
      result.panelError = undefined
    } catch (error) {
      result.panelError = publicError(error, 'The panel could not start.')
    }
  }
}
