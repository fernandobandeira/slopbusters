import { seatReviewer, type PanelSeatRequest } from '../../../shared/domain/panel'
import {
  stoppedWithWork,
  type PanelResult,
  type PanelSession,
} from '../../../shared/domain/panelSession'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import type { StackLayer, StackReviewSession } from '../../../shared/domain/stackReview'
import type { PanelJobs } from '../panel/panelJobs'

export interface LayerPanels {
  panels: Pick<PanelJobs, 'start' | 'latest' | 'get' | 'retry' | 'cancel'>
  /** A PR's newest panel results, newest first. */
  results: (repository: string, url: string) => { session: string; result: PanelResult }[]
  pollMs: number
}

interface Run {
  signal: AbortSignal
  /** Whether this run retries a stack review that stopped, so stopped panels run again. */
  retry: boolean
  /** Panels from the prior stack review that an explicit new selection can replace if stopped. */
  previousPanels?: readonly string[]
  save: () => void
}

/**
 * Give every layer an up-to-date panel result: reuse one reviewed at the layer's current head
 * and base with the selected seats, wait for an active panel, or start one. Panels run side by
 * side as slots allow. Resolves once no panel is working. A layer whose panel failed or waits on
 * the author is left stopped with the reason.
 */
export async function runLayerPanels(
  session: StackReviewSession,
  layers: LayerPanels,
  run: Run,
): Promise<void> {
  for (const layer of session.layers) {
    run.signal.throwIfAborted()
    Object.assign(layer, { note: undefined }, await panelFor(session, layer, layers, run))
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

/** The result each layer's panel ended with. */
export function layerRounds(session: StackReviewSession, layers: LayerPanels) {
  return session.layers.map((layer) => {
    const current = layers.panels
      .get(layer.panel ?? '')
      .results.find((result) => result.pull.url === layer.url)
    if (!current) throw new Error('Missing panel result for a reviewed layer.')
    return { layer, current }
  })
}

async function panelFor(
  session: StackReviewSession,
  layer: StackLayer,
  { panels, results }: LayerPanels,
  { retry, previousPanels }: Run,
): Promise<Pick<StackLayer, 'state' | 'panel' | 'note'>> {
  const active = panels.latest(session.repository, layer.url)
  if (active && working(active, layer.url, retry)) {
    if (active.status === 'running') return attach(active, session.reviewers)
    if (retry) return { state: 'reviewing', panel: panels.retry(active.id).id }
    const replace = active.urls.length === 1 && previousPanels?.includes(active.id)
    if (!replace || sameSeats(active, session.reviewers))
      return { state: 'stopped', panel: active.id }
    panels.cancel(active.id)
  }
  const newest = results(session.repository, layer.url)[0]
  if (
    newest &&
    newest.result.pull.headSha === layer.headSha &&
    newest.result.pull.baseSha === layer.baseSha &&
    sameSeats(panels.get(newest.session), session.reviewers)
  )
    return { state: 'reused', panel: newest.session }
  // A panel covering several PRs can still hold the layer after it has reviewed it.
  if (active?.status === 'running') return attach(active, session.reviewers)
  const started = await panels.start(session.repository, [layer.url], session.reviewers)
  return { state: 'reviewing', panel: started.id }
}

function attach(panel: PanelSession, reviewers: readonly PanelSeatRequest[]) {
  const names = panel.reviewers.map((seat) => seat.name).join(', ')
  return {
    state: 'reviewing' as const,
    panel: panel.id,
    note: sameSeats(panel, reviewers) ? undefined : `Already being reviewed by ${names}.`,
  }
}

function sameSeats(panel: PanelSession, requested: readonly PanelSeatRequest[]): boolean {
  const wanted = new Set(
    requested.flatMap((seat) =>
      typeof seat === 'string'
        ? []
        : (seat.providers ?? []).map((provider) => `${seat.id}@${provider}`),
    ),
  )
  const seats = new Set(
    panel.reviewers.map(
      (seat) => `${seatReviewer(seat.id)}@${seat.model?.provider ?? panel.model.provider}`,
    ),
  )
  return seats.size === wanted.size && [...seats].every((seat) => wanted.has(seat))
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
    layer.note = undefined
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
