import type { BriefSerious, StackBrief } from './stackBrief'
import type { BriefLayer } from './stackBriefLayers'
import type { BriefDecision } from './stackDecisions'
import type { ClaimRecord, DecisionSnapshot, RevisionPair } from './stackReviewRecords'

export function decisionSnapshot(
  brief: StackBrief,
  decision: BriefDecision,
  confirm = false,
): DecisionSnapshot {
  const entryIds = [
    ...new Set([...decision.evidence.map(({ id }) => id), ...(decision.relatedEntries ?? [])]),
  ].sort()
  const reshapesStack = decision.options.some(({ change }) => change?.structure)
  const relevant = reshapesStack
    ? brief.layers.map(({ number }) => number)
    : [
        ...(decision.relatedLayers ?? []),
        decision.layer,
        ...decision.evidence.flatMap((entry) => [
          entry.layer,
          entry.destination?.pull,
          entry.settledBy,
        ]),
        ...decision.options.flatMap(({ change }) => [change?.layer, change?.structure?.into]),
      ]
  return {
    title: decision.title,
    question: decision.question,
    options: decision.options,
    entryIds,
    layers: snapshotLayers(brief.layers, relevant, confirm),
  }
}

export function claimSnapshot(brief: StackBrief, claim: BriefSerious): ClaimRecord['snapshot'] {
  const { title, entryIds, consequence, impact, standing, contested, layer, relatedLayers } = claim
  return {
    title,
    entryIds,
    consequence,
    impact,
    standing,
    contested,
    layers: snapshotLayers(brief.layers, [layer, ...relatedLayers], false),
  }
}

function snapshotLayers(
  layers: BriefLayer[],
  relevant: (number | undefined)[],
  confirm: boolean,
): DecisionSnapshot['layers'] {
  return layers
    .filter(({ number }) => relevant.includes(number))
    .map((layer) => ({
      pull: layer.number,
      reviewed: { head: layer.reviewedHead, base: layer.reviewedBase },
      ...(confirm ? { confirmed: currentRevision(layer) } : {}),
    }))
    .sort((a, b) => a.pull - b.pull)
}

function currentRevision(layer: BriefLayer): RevisionPair {
  return {
    head: layer.currentHead ?? layer.reviewedHead,
    base: layer.currentBase ?? layer.reviewedBase,
  }
}

export function observedLayers(snapshot: DecisionSnapshot, brief: StackBrief) {
  return snapshot.layers.flatMap(({ pull }) => {
    const layer = brief.layers.find(({ number }) => number === pull)
    return layer ? [{ pull, ...currentRevision(layer) }] : []
  })
}

export function needsRecheck(snapshot: DecisionSnapshot, brief: StackBrief): boolean {
  return snapshot.layers.some(({ pull, reviewed, confirmed }) => {
    const layer = brief.layers.find(({ number }) => number === pull)
    return !layer || !sameRevision(confirmed ?? reviewed, currentRevision(layer))
  })
}

function sameRevision(first: RevisionPair, second: RevisionPair): boolean {
  return first.head === second.head && first.base === second.base
}

export function matchesSnapshot(previous: DecisionSnapshot, current: DecisionSnapshot): boolean {
  // Zod's parsing order need not match the construction order of an option or its effect.
  return canonical(previous) === canonical(current)
}

function canonical(value: DecisionSnapshot): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const entries: [string, unknown][] = Object.entries(item)
    return Object.fromEntries(
      entries.filter(([key]) => key !== 'confirmed').sort(([a], [b]) => a.localeCompare(b)),
    )
  })
}
