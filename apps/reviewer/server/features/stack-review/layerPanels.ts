import {
  stoppedWithWork,
  type PanelResult,
  type PanelSession,
} from '../../../shared/domain/panelSession'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import type { StackLayer, StackReviewSession } from '../../../shared/domain/stackReview'
import type { PanelJobs } from '../panel/panelJobs'

export interface LayerPanels {
  panels: Pick<PanelJobs, 'start' | 'latest' | 'get' | 'retry'>
  /** A PR's newest panel results, newest first. */
  results: (repository: string, url: string) => { session: string; result: PanelResult }[]
  pollMs: number
}

interface Run {
  signal: AbortSignal
  /** Whether this run retries a stack review that stopped, so stopped panels run again. */
  retry: boolean
  save: () => void
}

/**
 * Give every layer an up-to-date panel result: reuse one reviewed at the layer's current head
 * and base, wait for a panel already working on it, and start one otherwise. Panels on different
 * layers run side by side as the panel's own slots allow. Resolves once no panel is working; a
 * layer whose panel failed or waits on the author is left stopped with the reason.
 */
export async function runLayerPanels(
  session: StackReviewSession,
  layers: LayerPanels,
  run: Run,
): Promise<void> {
  for (const layer of session.layers) {
    run.signal.throwIfAborted()
    Object.assign(layer, await panelFor(session, layer, layers, run), { note: undefined })
    if (layer.state === 'stopped')
      layer.note = stoppedNote(layer, layers.panels.get(layer.panel ?? ''))
    run.save()
  }
  for (;;) {
    run.signal.throwIfAborted()
    const reviewing = session.layers.filter((layer) => layer.state === 'reviewing')
    if (!reviewing.length) return
    for (const layer of reviewing) settle(layer, layers.panels.get(layer.panel ?? ''))
    if (reviewing.some((layer) => layer.state !== 'reviewing')) run.save()
    else await pause(layers.pollMs, run.signal)
  }
}

/** The result each layer's panel ended with, and the newest result from another round. */
export function layerRounds(session: StackReviewSession, layers: LayerPanels) {
  return session.layers.map((layer) => {
    const current = layers.panels
      .get(layer.panel ?? '')
      .results.find((result) => result.pull.url === layer.url)
    if (!current) throw new Error('Missing panel result for a reviewed layer.')
    const earlier = layers
      .results(session.repository, layer.url)
      .find((item) => item.session !== layer.panel)?.result
    return { layer, current, ...(earlier ? { earlier } : {}) }
  })
}

async function panelFor(
  session: StackReviewSession,
  layer: StackLayer,
  { panels, results }: LayerPanels,
  { retry }: Run,
): Promise<Pick<StackLayer, 'state' | 'panel'>> {
  const active = panels.latest(session.repository, layer.url)
  if (active && working(active, layer.url, retry)) {
    if (active.status === 'running') return { state: 'reviewing', panel: active.id }
    if (!retry) return { state: 'stopped', panel: active.id }
    return { state: 'reviewing', panel: panels.retry(active.id).id }
  }
  const newest = results(session.repository, layer.url)[0]
  const pull = newest?.result.pull
  if (newest && pull && pull.headSha === layer.headSha && pull.baseSha === layer.baseSha)
    return { state: 'reused', panel: newest.session }
  const started = await panels.start(session.repository, [layer.url], session.reviewers)
  return { state: 'reviewing', panel: started.id }
}

/** A panel still on its way to this layer's result: running, waiting on the author, or stopped. */
function working(panel: PanelSession, url: string, retry: boolean): boolean {
  if (panel.results.some((result) => result.pull.url === url)) return false
  if (blocksNewReview(panel)) return true
  return retry && stoppedWithWork(panel) && panel.pending?.pull.url === url
}

function settle(layer: StackLayer, panel: PanelSession) {
  if (panel.status === 'running') return
  if (panel.results.some((result) => result.pull.url === layer.url)) {
    layer.state = 'reviewed'
    return
  }
  layer.state = 'stopped'
  layer.note = stoppedNote(layer, panel)
}

function stoppedNote(layer: StackLayer, panel: PanelSession): string {
  const name = `PR #${String(layer.number)}`
  const why = [panel.error, panel.progress].filter(Boolean).join(' ')
  if (panel.status === 'partial')
    return `${name}'s panel is waiting on you: ${why} Retry the stack review to run those reviewers again, or open the panel to ground the reviews that finished.`
  return `${name}'s panel ${panel.status === 'cancelled' ? 'was cancelled' : 'failed'}: ${why} Retry the stack review to run it again.`
}

/** Resolves after `milliseconds`; rejects as soon as the run is cancelled. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason as Error)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}
