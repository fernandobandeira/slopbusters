import { useState } from 'react'
import * as routes from '../../../shared/api'
import type { ActivePanel } from '../../../shared/domain/panel'
import type { Provider } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'
import { PanelPickerPopover, type PanelStart } from './PanelPicker'
import type { PanelChoice } from './panelSelection'

/** What a batch start did: the panels it started, and the PRs it skipped with the reason. */
export interface PanelBatchStarted {
  panels: ActivePanel[]
  skipped: { url: string; reason: string }[]
}

/**
 * Ask the panel about several PRs at once. Each PR gets its own review with the same reviewers,
 * so they run side by side and each one finishes on its own.
 */
export function PanelBatchPicker({
  repository,
  urls,
  provider,
  onStarted,
  onLinus,
}: {
  repository: string
  urls: string[]
  provider?: Provider
  onStarted: (started: PanelBatchStarted) => void
  /** Linus went first instead: the panel follows his verdict on each PR. */
  onLinus?: (sessionId: string) => void
}) {
  const start = useBatchStart({ repository, urls, onStarted, onLinus })
  const count = `${String(urls.length)} PR${urls.length === 1 ? '' : 's'}`
  return (
    <PanelPickerPopover
      label={`Ask the review panel about ${count}`}
      subject={count}
      provider={provider}
      start={start}
      disabled={!urls.length}
    />
  )
}

function useBatchStart({
  repository,
  urls,
  onStarted,
  onLinus,
}: {
  repository: string
  urls: string[]
  onStarted: (started: PanelBatchStarted) => void
  onLinus?: (sessionId: string) => void
}): PanelStart {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  async function run(reviewers: PanelChoice[], linusFirst: boolean): Promise<boolean> {
    setStarting(true)
    setError('')
    askToNotify()
    try {
      if (linusFirst && onLinus) {
        const linus = await call(routes.startLinus, {
          body: { repository, urls, thenPanel: { reviewers } },
        })
        onLinus(linus.id)
        return true
      }
      onStarted(await call(routes.startPanels, { body: { repository, urls, reviewers } }))
      return true
    } catch (cause) {
      setError(message(cause))
      return false
    } finally {
      setStarting(false)
    }
  }
  return { run, starting, error, linusFirst: Boolean(onLinus) }
}

/** Ask once, while the user is clicking, to say when a panel finishes in the background. */
function askToNotify() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission().catch(() => undefined)
}
