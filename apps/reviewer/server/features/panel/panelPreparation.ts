import type { LayerSnapshot } from '../../../shared/domain/anchors'
import type {
  PanelPreparation,
  PanelSnapshot,
  ReviewHistory,
} from '../../../shared/domain/panelSession'
import type { PullStackResult } from '../../../shared/domain/stacks'
import type { PullRequest } from '../../../shared/domain/types'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import { publicError, UserError } from '../../errors'
import { MAX_PANEL_STACK_LAYERS, PANEL_PREPARE_CONCURRENCY } from './limits'
import { pullFingerprint } from '../../reviewSnapshot'
import { settleEach } from '../flows/panel'

interface Sources {
  loadPull: (url: string) => Promise<PullRequest>
  /** What reviewers already said on a PR, which every seat reads. */
  history?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewHistory>
  stack?: (url: string) => Promise<PullStackResult>
  context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
  signal: AbortSignal
  progress: (progress: string) => void
}

/**
 * Load every chosen PR, then the other open layers of their stacks, a few at a time, before any
 * seat starts, so the first layer's seats already see the layers above it. A layer that cannot
 * be loaded is disclosed rather than skipped silently.
 */
export async function preparePanelRound(
  urls: readonly string[],
  sources: Sources,
): Promise<PanelPreparation> {
  sources.progress(`Loading ${pullCount(urls.length)}…`)
  const snapshots = (await loadSnapshots(urls, sources, true)).map((outcome) => {
    if (!outcome.advice) throw new UserError(outcome.error ?? 'The PR could not be loaded.')
    return outcome.advice
  })
  const stacks = await stackLayers(urls, sources)
  await addHistory(snapshots, stacks.missing, sources)
  const wanted = [...new Set(Object.values(stacks.layers).flat())].filter(
    (url) => !urls.includes(url),
  )
  if (wanted.length) sources.progress(`Loading ${pullCount(wanted.length, 'other layer')}…`)
  const siblings = await loadSnapshots(wanted, sources, false)
  const failed = new Map(
    wanted.flatMap((url, index) => {
      const error = siblings[index]?.error
      return error === undefined ? [] : [[url, error] as const]
    }),
  )
  snapshots.push(...siblings.flatMap((outcome) => (outcome.advice ? [outcome.advice] : [])))
  const preparation: PanelPreparation = { snapshots, layers: {}, missing: stacks.missing }
  for (const [url, layers] of Object.entries(stacks.layers)) {
    preparation.layers[url] = layers.filter((layer) => !failed.has(layer))
    const unloaded = layers.filter((layer) => failed.has(layer))
    if (unloaded.length)
      (preparation.missing[url] ??= []).push(
        `Other stack layers could not be loaded, so findings about them could not be checked: ${unloaded.map((layer) => `${pullLabel(layer)} (${failed.get(layer) ?? ''})`).join('; ')}.`,
      )
  }
  return preparation
}

/** The loaded layers of a chosen PR's stack, as anchor evidence. */
export function layersOf(preparation: PanelPreparation, url: string): LayerSnapshot[] {
  return (preparation.layers[url] ?? []).flatMap((layer) => {
    const snapshot = preparation.snapshots.find((entry) => entry.pull.url === layer)
    return snapshot ? [{ pull: snapshot.pull, fingerprint: snapshot.fingerprint }] : []
  })
}

function loadSnapshots(urls: readonly string[], sources: Sources, withContext: boolean) {
  const { signal } = sources
  return settleEach(urls, {
    signal,
    concurrency: PANEL_PREPARE_CONCURRENCY,
    run: async (url): Promise<PanelSnapshot> => {
      const pull = await sources.loadPull(url)
      signal.throwIfAborted()
      const context = withContext ? await sources.context?.(pull, signal) : undefined
      signal.throwIfAborted()
      return { pull, fingerprint: pullFingerprint(pull), ...(context ? { context } : {}) }
    },
    failure: () => 'The PR could not be loaded.',
  })
}

/** Each chosen PR's existing review comments; one that cannot be loaded is disclosed. */
async function addHistory(
  snapshots: PanelSnapshot[],
  missing: Record<string, string[]>,
  { history, signal }: Sources,
) {
  if (!history) return
  const loaded = await settleEach(snapshots, {
    signal,
    concurrency: PANEL_PREPARE_CONCURRENCY,
    run: (snapshot) => history(snapshot.pull, signal),
    failure: () => 'GitHub did not return them.',
  })
  snapshots.forEach((snapshot, index) => {
    const outcome = loaded[index]
    if (outcome?.advice) snapshot.history = outcome.advice
    else
      (missing[snapshot.pull.url] ??= []).push(
        `The PR's existing review comments could not be loaded (${outcome?.error ?? 'unknown error'}), so teammates did not see what they already said.`,
      )
  })
}

/** Each chosen PR's other open stack layers, and what could not be found out about them. */
async function stackLayers(urls: readonly string[], { stack, signal }: Sources) {
  const layers: Record<string, string[]> = {}
  const missing: Record<string, string[]> = {}
  if (!stack) return { layers, missing }
  const results = await settleEach(urls, {
    signal,
    concurrency: PANEL_PREPARE_CONCURRENCY,
    run: (url) => stack(url),
    failure: () => 'Stack metadata is unavailable.',
  })
  urls.forEach((url, index) => {
    const outcome = results[index]
    if (!outcome?.advice) {
      missing[url] = [
        `The PR's stack could not be determined (${outcome?.error ?? 'unknown error'}), so other layers were not inspected.`,
      ]
      return
    }
    const open = (outcome.advice.stack?.items ?? []).filter(
      (item) => item.state === 'open' && item.url !== url,
    )
    layers[url] = open.slice(0, MAX_PANEL_STACK_LAYERS).map((item) => item.url)
    const notes = [
      ...(outcome.advice.incomplete
        ? ['The stack is incomplete or ambiguous, so some layers may be missing.']
        : []),
      ...(open.length > MAX_PANEL_STACK_LAYERS
        ? [
            `Only ${String(MAX_PANEL_STACK_LAYERS)} of the ${String(open.length)} other open layers were loaded.`,
          ]
        : []),
    ]
    if (notes.length) missing[url] = notes
  })
  return { layers, missing }
}

function pullCount(count: number, noun = 'PR') {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

/** `PR #131` from its URL. */
function pullLabel(url: string) {
  return `PR #${url.split('/').pop() ?? url}`
}

/** The saved checkout of the PR head; without one, reviewers read the snapshot only. */
export async function openSource(
  open: ((pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>) | undefined,
  pull: PullRequest,
  signal: AbortSignal,
): Promise<{ repository?: ReviewCheckout; limitation?: string }> {
  if (!open) return {}
  try {
    return { repository: await open(pull, signal) }
  } catch (error) {
    signal.throwIfAborted()
    return {
      limitation: `Local repository inspection was unavailable: ${publicError(error, 'Source could not be prepared.')} The panel used the supplied PR snapshot.`,
    }
  }
}
