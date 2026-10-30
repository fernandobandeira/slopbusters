import type { ActivePanel, PanelSeatRequest } from '../../../shared/domain/panel'
import { stoppedWithWork, type PanelSession } from '../../../shared/domain/panelSession'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import { UserError } from '../../errors'
import type { PanelJobs } from './panelJobs'

/**
 * Start the same panel on each PR in its own review, so they run side by side. A PR whose panel
 * is still working with other reviewers is skipped with the reason; one with the same reviewers
 * keeps its panel.
 */
export async function startEach(
  jobs: Pick<PanelJobs, 'start'>,
  {
    repository,
    urls,
    reviewers,
  }: { repository: string; urls: string[]; reviewers: PanelSeatRequest[] },
): Promise<{ panels: ActivePanel[]; skipped: { url: string; reason: string }[] }> {
  const panels: ActivePanel[] = []
  const skipped: { url: string; reason: string }[] = []
  for (const url of urls) {
    try {
      panels.push(activePanel(await jobs.start(repository, [url], reviewers), url))
    } catch (error) {
      if (!(error instanceof UserError) || error.status !== 409) throw error
      skipped.push({ url, reason: error.message })
    }
  }
  return { panels, skipped }
}

/** Each PR's newest panel that has not finished: running, queued, waiting on you, or stopped. */
export function activePanels(
  jobs: Pick<PanelJobs, 'get'>,
  store: Pick<PanelSessionStore, 'unfinished'>,
  repository: string,
): ActivePanel[] {
  return store.unfinished(repository).flatMap(({ url, session: saved }) => {
    // Reading it through the jobs marks a panel the app stopped as cancelled.
    const session = jobs.get(saved.id)
    if (session.results.some((result) => result.pull.url === url)) return []
    const stopped = stoppedWithWork(session) && session.pending?.pull.url === url
    return blocksNewReview(session) || stopped ? [activePanel(session, url)] : []
  })
}

function activePanel(session: PanelSession, url: string): ActivePanel {
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
