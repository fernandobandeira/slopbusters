import type { ActivePanel } from '../../../shared/domain/panel'
import type { SettledPanel } from './useActivePanels'

/**
 * Say through the system that panels stopped, so a review finishing in the background is noticed.
 * Clicking one opens its PR with the panel. Nothing shows until the user allowed notifications.
 */
export function notifySettled(
  settled: SettledPanel[],
  options: { titleFor: (url: string) => string | undefined; onOpen: (panel: ActivePanel) => void },
) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  for (const { panel, outcome } of settled) {
    const notification = new Notification(heading(panel, outcome), {
      body: options.titleFor(panel.url) ?? '',
      tag: `panel:${panel.sessionId}`,
    })
    notification.onclick = () => {
      window.focus()
      options.onOpen(panel)
    }
  }
}

function heading(panel: ActivePanel, outcome: SettledPanel['outcome']) {
  const pull = `PR #${String(panel.number)}`
  if (outcome === 'complete') return `The panel finished ${pull}`
  if (outcome === 'partial') return `The panel needs you on ${pull}`
  return `The panel stopped on ${pull}`
}
