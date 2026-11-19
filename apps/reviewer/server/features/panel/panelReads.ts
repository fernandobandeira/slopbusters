import type { ActivePanel } from '../../../shared/domain/panel'
import { summarizePanel, type PanelSessionSummary } from '../../../shared/domain/panelSession'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import { UserError } from '../../errors'
import type { PanelJobs } from './panelJobs'

type PanelReader = Pick<PanelJobs, 'get' | 'isLive'>

/** Each PR's newest panel that has not finished: running, queued, waiting on you, or stopped. */
export function activePanels(
  jobs: PanelReader,
  store: Pick<PanelSessionStore, 'unfinished'>,
  repository: string,
): ActivePanel[] {
  return store.unfinished(repository).flatMap(({ url, session: saved }) => {
    const session = recoverSummary(jobs, saved)
    return blocksNewReview(session) || session.stoppedUrl === url ? [activePanel(session, url)] : []
  })
}

export function latestPanel(
  jobs: PanelReader,
  store: PanelSessionStore,
  { repository, url }: { repository: string; url: string },
) {
  const id = store.latestId(repository, url)
  const state = id ? store.state(id) : undefined
  return state ? recoverSummary(jobs, state.summary) : null
}

export function pollPanel(jobs: PanelReader, store: PanelSessionStore, id: string, after?: number) {
  let state = store.state(id)
  // Reading an interrupted panel through the jobs cancels and saves it, which moves its revision.
  if (state && interrupted(jobs, state.summary)) {
    jobs.get(id)
    state = store.state(id)
  }
  if (!state) throw new UserError('This panel review is no longer available.', 404)
  return { revision: state.revision, session: after === state.revision ? null : jobs.get(id) }
}

function interrupted(jobs: PanelReader, session: PanelSessionSummary) {
  return session.status === 'running' && !jobs.isLive(session.id)
}

function recoverSummary(jobs: PanelReader, summary: PanelSessionSummary) {
  return interrupted(jobs, summary) ? summarizePanel(jobs.get(summary.id)) : summary
}

export function activePanel(session: PanelSessionSummary, url: string): ActivePanel {
  const status = session.status === 'complete' ? 'running' : session.status
  return {
    sessionId: session.id,
    url,
    number: parsePullUrl(url).number,
    status,
    queued: status === 'running' && Boolean(session.queued),
    progress: session.progress,
    reviewers: session.reviewers.map((reviewer) => reviewer.id),
  }
}
