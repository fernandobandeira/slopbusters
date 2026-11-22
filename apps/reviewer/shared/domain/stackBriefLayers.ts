import type { StackPassInput, StackReviewSession } from './stackReview'

export interface BriefLayer {
  number: number
  title: string
  url: string
  reviewedHead?: string
  currentHead?: string
  reviewedBase?: string
  currentBase?: string
  /** False when the layer's head or base moved since its panel reviewed it. */
  current: boolean
}
export interface BriefStale {
  layer: number
  entries: string[]
  reason: string
}

export function briefLayers(session: StackReviewSession, input: StackPassInput): BriefLayer[] {
  return session.layers.map((layer) => {
    const reviewed = input.layers.find((item) => item.number === layer.number)
    const revisions = {
      number: layer.number,
      title: layer.title,
      url: layer.url,
      ...(reviewed
        ? { reviewedHead: reviewed.reviewedHead, reviewedBase: reviewed.reviewedBase }
        : {}),
      ...(layer.headSha ? { currentHead: layer.headSha } : {}),
      ...(layer.baseSha ? { currentBase: layer.baseSha } : {}),
    }
    return { ...revisions, current: Boolean(reviewed) && !layerMoved(revisions) }
  })
}

/**
 * Entries that may no longer hold: every entry of a layer that moved since its panel, and each
 * entry settled by a layer whose head is not the one its grounding read.
 */
export function staleEntries(input: StackPassInput, layers: readonly BriefLayer[]): BriefStale[] {
  const heads = new Map(layers.map((layer) => [layer.number, layer.currentHead]))
  const moved = layers.filter(layerMoved).map((layer) => ({
    layer: layer.number,
    entries: input.entries.filter((entry) => entry.layer === layer.number).map((entry) => entry.id),
    reason: movedReason(layer),
  }))
  const settled = input.entries.flatMap((entry) => {
    const layer = entry.settledBy
    const read = input.layers
      .find((item) => item.number === entry.layer)
      ?.read.find((item) => item.pull === layer)?.headSha
    const now = layer === undefined ? undefined : heads.get(layer)
    if (layer === undefined || !read || !now || read === now) return []
    return [
      {
        layer,
        entries: [entry.id],
        reason: `Settled by PR #${String(layer)} at \`${short(read)}\`, which is at \`${short(now)}\` now.`,
      },
    ]
  })
  return [...moved, ...settled]
}

export function layerMoved(layer: Omit<BriefLayer, 'current'>): boolean {
  return Boolean(
    layer.reviewedHead &&
    layer.currentHead &&
    (layer.reviewedHead !== layer.currentHead || layer.reviewedBase !== layer.currentBase),
  )
}

export function movedReason(layer: BriefLayer): string {
  const name = `PR #${String(layer.number)}`
  if (layer.currentHead !== layer.reviewedHead)
    return `${name} moved since its panel reviewed \`${short(layer.reviewedHead)}\`; it is at \`${short(layer.currentHead)}\` now.`
  return `${name}'s base moved since its panel reviewed it on \`${short(layer.reviewedBase)}\`; it is on \`${short(layer.currentBase)}\` now, so its diff may differ.`
}

export function short(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : 'unknown'
}
