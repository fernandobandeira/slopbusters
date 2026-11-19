import type { EarlierRequest } from './consistency'
import { leadSource, type ResolvedEntry } from './grounding'
import type { PanelResult } from './panelSession'
import {
  stackEntryId,
  type StackEntry,
  type StackLayer,
  type StackPassInput,
  type StackPassLayer,
} from './stackReview'
import { triage } from './triage'

/** One layer's panel round: the one the stack review uses. */
export interface LayerRounds {
  layer: Pick<StackLayer, 'number' | 'title' | 'url'>
  current: PanelResult
}

/**
 * The compact view of every layer the cross-layer pass reads: each layer's revision and diff
 * stat and every grounded entry with its triage. Past `budget` characters, skipped entries go
 * first; what was left out is named in the limitations, never dropped silently.
 */
export function stackPassInput(rounds: readonly LayerRounds[], budget: number): StackPassInput {
  const input: StackPassInput = {
    layers: rounds.map(passLayer),
    entries: rounds.flatMap(({ layer, current }) => entriesOf(layer.number, current)),
    left: [],
    limitations: rounds
      .filter(({ current }) => !current.grounding?.resolved)
      .map(
        ({ layer }) =>
          `PR #${String(layer.number)}'s panel result predates grounding, so its findings are not in the cross-layer pass.`,
      ),
  }
  fitBudget(input, budget)
  return input
}

/** What the pass's prompt carries of the input: the layers and the entries it was not denied. */
export function passView(input: StackPassInput) {
  const left = new Set(input.left)
  return {
    layers: input.layers,
    entries: input.entries
      .filter((entry) => !left.has(entry.id))
      .map(({ rank: _rank, raisedBy: _raisedBy, ...entry }) => entry),
  }
}

function passLayer({ layer, current }: LayerRounds): StackPassLayer {
  const { files } = current.pull
  return {
    number: layer.number,
    title: layer.title,
    url: layer.url,
    reviewedHead: current.pull.headSha,
    reviewedBase: current.pull.baseSha,
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    read: current.grounding?.stack ?? [],
  }
}

function entriesOf(layer: number, result: PanelResult): StackEntry[] {
  const candidates = result.grounding?.candidates ?? []
  const requests = result.grounding?.earlier?.requests ?? []
  return (result.grounding?.resolved ?? []).map((entry) => {
    const decision = triage(entry)
    return {
      id: stackEntryId(layer, entry.id),
      layer,
      title: leadSource(entry, candidates)?.finding.title ?? entry.id,
      resolution: entry.resolution,
      disposition: decision.disposition,
      rank: decision.rank,
      triage: decision.reason,
      followUp: decision.followUp,
      reason: entry.reason,
      evidence: entry.evidence,
      raisedBy: entry.raisedBy,
      ...optional(entry),
      ...marks(layer, entry, requests),
    }
  })
}

function optional(entry: ResolvedEntry): Partial<StackEntry> {
  const { destination } = entry
  return {
    ...(entry.kind ? { kind: entry.kind } : {}),
    ...(entry.effort ? { effort: entry.effort } : {}),
    ...(entry.verdict ? { verdict: entry.verdict } : {}),
    ...(entry.plan ? { plan: entry.plan } : {}),
    ...(entry.question ? { question: entry.question } : {}),
    ...(entry.origin ? { origin: entry.origin } : {}),
    ...(entry.settledBy ? { settledBy: entry.settledBy.pull } : {}),
    ...(destination.kind === 'code' ? { destination: { pull: destination.pull } } : {}),
    ...(destination.kind === 'metadata'
      ? { destination: { pull: destination.pull, field: destination.field } }
      : {}),
  }
}

/** The consistency check's marks, with the earlier request resolved and ids made stack-wide. */
function marks(
  layer: number,
  entry: ResolvedEntry,
  requests: readonly EarlierRequest[],
): Partial<StackEntry> {
  const { reverses, opposes } = entry
  const request = reverses && requests.find((item) => item.key === reverses.earlier)
  return {
    ...(reverses && request
      ? { reverses: { request: withoutKey(request), reason: reverses.reason } }
      : {}),
    ...(opposes
      ? {
          opposes: {
            entries: opposes.entries.map((id) => stackEntryId(layer, id)),
            reason: opposes.reason,
          },
        }
      : {}),
  }
}

function withoutKey({ key: _key, ...request }: EarlierRequest): Omit<EarlierRequest, 'key'> {
  return request
}

/** Leave out skipped entries, newest layer first, until the view fits. */
function fitBudget(input: StackPassInput, budget: number) {
  const size = () => JSON.stringify(passView(input)).length
  const skipped = input.entries.filter((entry) => entry.disposition === 'skip')
  const left: string[] = []
  for (const entry of [...skipped].reverse()) {
    if (size() <= budget) break
    input.left.push(entry.id)
    left.push(entry.id)
  }
  if (left.length)
    input.limitations.push(
      `To fit the cross-layer pass's budget, ${String(left.length)} skipped entr${left.length === 1 ? 'y was' : 'ies were'} left out of it: ${left.join(', ')}.`,
    )
  if (size() > budget)
    input.limitations.push(
      "Even without them, the cross-layer pass's input is over its budget; it read every remaining entry.",
    )
}
