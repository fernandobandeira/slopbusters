import { useEffect, useEffectEvent, useRef } from 'react'
import * as routes from '../../../shared/api'
import type { ActivePanel } from '../../../shared/domain/panel'
import { useApiQuery } from '../../lib/useApiQuery'

const RUNNING_POLL_MS = 2500
const IDLE_POLL_MS = 15_000

/** A panel that stopped running: finished with a result, waiting on the user, or stopped. */
export interface SettledPanel {
  panel: ActivePanel
  outcome: 'complete' | 'partial' | 'failed' | 'cancelled'
}

/**
 * Every PR's unfinished panel in the repository, polled quickly while one runs. `onSettled`
 * hears each panel that stops running, so the list can show its result and say it is ready.
 */
export function useActivePanels({
  repository,
  enabled,
  refresh,
  onSettled,
}: {
  repository: string
  enabled: boolean
  refresh?: number
  onSettled: (settled: SettledPanel[]) => void
}) {
  const query = useApiQuery(
    routes.activePanels,
    { query: { repository } },
    { enabled: enabled && Boolean(repository), refresh },
  )
  const panels = query.data?.panels
  const running = Boolean(panels?.some((panel) => panel.status === 'running'))
  const { reload } = query
  useEffect(() => {
    if (!enabled || !repository) return
    const timer = setInterval(
      () => {
        if (running || !document.hidden) reload()
      },
      running ? RUNNING_POLL_MS : IDLE_POLL_MS,
    )
    return () => {
      clearInterval(timer)
    }
  }, [enabled, repository, running, reload])
  useSettledPanels(repository, panels, onSettled)
  return {
    panelFor: (url: string) => panels?.find((panel) => panel.url === url),
    reload,
  }
}

/** Compare each poll with the last one in the same repository, and report what stopped. */
function useSettledPanels(
  repository: string,
  panels: ActivePanel[] | undefined,
  onSettled: (settled: SettledPanel[]) => void,
) {
  const previous = useRef<{ repository: string; panels: ActivePanel[] }>(undefined)
  const report = useEffectEvent(onSettled)
  useEffect(() => {
    if (!panels) return
    const before = previous.current
    previous.current = { repository, panels }
    if (before?.repository !== repository) return
    const settled = settledSince(before.panels, panels)
    if (settled.length) report(settled)
  }, [repository, panels])
}

/** The panels that ran before and run no more; one that left the list finished with a result. */
export function settledSince(before: ActivePanel[], now: ActivePanel[]): SettledPanel[] {
  return before.flatMap((panel) => {
    if (panel.status !== 'running') return []
    const next = now.find((item) => item.url === panel.url)
    if (next?.status === 'running') return []
    return [{ panel, outcome: next?.status ?? 'complete' }]
  })
}
