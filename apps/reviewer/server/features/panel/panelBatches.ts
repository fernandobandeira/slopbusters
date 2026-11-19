import type { ActivePanel, PanelSeatRequest } from '../../../shared/domain/panel'
import { summarizePanel } from '../../../shared/domain/panelSession'
import { UserError } from '../../errors'
import type { PanelJobs } from './panelJobs'
import { activePanel } from './panelReads'

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
      panels.push(activePanel(summarizePanel(await jobs.start(repository, [url], reviewers)), url))
    } catch (error) {
      if (!(error instanceof UserError) || error.status !== 409) throw error
      skipped.push({ url, reason: error.message })
    }
  }
  return { panels, skipped }
}
