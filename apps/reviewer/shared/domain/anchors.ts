import { z } from 'zod'
import { findingLine, type FindingLocation } from './findings'
import { DiffSide, LineKind, type PullRequest } from './types'

/**
 * Where a review comment belongs. A reviewer comments on changed lines, but also on unchanged
 * code the change affects, on the PR's title or description, and on another layer of its stack.
 */
const path = z.string().min(1).max(1000)
const line = z.number().int().positive()
const side = z.enum(DiffSide)
const hunkId = z.string().min(1).max(200)

/** A line the PR changed, inside one of its hunks. */
const changeAnchorSchema = z
  .object({ kind: z.literal('change'), path, hunkId, line, side })
  .strict()
/** An unchanged line the change affects; `hunkId` only when the line is inside a hunk. */
const contextAnchorSchema = z
  .object({ kind: z.literal('context'), path, line, side, hunkId: hunkId.optional() })
  .strict()
export const metadataFields = ['title', 'description'] as const
/** The PR's title or description, with the passage at issue when there is one. */
const descriptionAnchorSchema = z
  .object({
    kind: z.literal('description'),
    field: z.enum(metadataFields),
    quote: z.string().min(1).max(500).optional(),
  })
  .strict()
const layerLocationSchema = z.discriminatedUnion('kind', [
  changeAnchorSchema,
  contextAnchorSchema,
  descriptionAnchorSchema,
])
/** Another layer of the PR's stack, and where on that layer. */
const stackAnchorSchema = z
  .object({
    kind: z.literal('stack'),
    pull: z.number().int().positive(),
    location: layerLocationSchema,
    /** The layer's snapshot fingerprint, set by the app when it places the anchor. */
    fingerprint: z.string().max(200).optional(),
  })
  .strict()

export const anchorSchema = z.discriminatedUnion('kind', [
  changeAnchorSchema,
  contextAnchorSchema,
  descriptionAnchorSchema,
  stackAnchorSchema,
])
export type Anchor = z.infer<typeof anchorSchema>
type LayerLocation = z.infer<typeof layerLocationSchema>

/** Another open layer of the stack, as loaded for this round. */
export interface LayerSnapshot {
  pull: PullRequest
  fingerprint: string
}

/** What an anchor is checked against: the reviewed PR, its loaded layers and its source. */
export interface AnchorEvidence {
  pull: PullRequest
  layers?: readonly LayerSnapshot[]
  /** Whether the reviewed checkout has this file, for context outside the diff. */
  sourceHas?: (path: string) => boolean
}

/** Why an anchor cannot be placed in the supplied evidence, or undefined when it can. */
export function anchorProblem(anchor: Anchor, evidence: AnchorEvidence): string | undefined {
  if (anchor.kind !== 'stack') return locationProblem(anchor, evidence.pull, evidence.sourceHas)
  if (anchor.pull === evidence.pull.number)
    return `PR #${String(anchor.pull)} is the PR under review, not another layer.`
  const layer = evidence.layers?.find((entry) => entry.pull.number === anchor.pull)
  if (!layer) return `PR #${String(anchor.pull)} is not a loaded layer of this stack.`
  return locationProblem(anchor.location, layer.pull)
}

/** The anchor as saved: a stack anchor records the layer snapshot it was checked against. */
export function placeAnchor(anchor: Anchor, evidence: AnchorEvidence): Anchor {
  if (anchor.kind !== 'stack') return anchor
  const layer = evidence.layers?.find((entry) => entry.pull.number === anchor.pull)
  return layer ? { ...anchor, fingerprint: layer.fingerprint } : anchor
}

function locationProblem(
  location: LayerLocation,
  pull: PullRequest,
  sourceHas?: (path: string) => boolean,
): string | undefined {
  if (location.kind === 'description') {
    if (!location.quote) return undefined
    const text = location.field === 'title' ? pull.title : pull.description
    return squash(text).includes(squash(location.quote))
      ? undefined
      : `The quoted passage is not in the PR ${location.field}.`
  }
  const where = `${location.path}:${String(location.line)}`
  if (location.kind === 'change') {
    const diffLine = findingLine(pull, { id: '', ...location })
    return diffLine && diffLine.kind !== LineKind.context
      ? undefined
      : `${where} is not a changed line of the snapshot.`
  }
  if (location.hunkId)
    return findingLine(pull, { id: '', ...location, hunkId: location.hunkId })
      ? undefined
      : `${where} is not in the hunk it names.`
  const changed = pull.files.some((file) => file.path === location.path)
  return changed || sourceHas?.(location.path)
    ? undefined
    : `${location.path} is not in the snapshot or the reviewed source.`
}

function squash(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The diff line an inline review comment can sit on: a changed line, or a context line inside a
 * hunk of this PR. Anything else belongs in the review summary.
 */
export function inlineLocation(
  pull: PullRequest,
  id: string,
  anchor: Anchor,
): FindingLocation | undefined {
  if (anchor.kind !== 'change' && !(anchor.kind === 'context' && anchor.hunkId)) return undefined
  const location = { id, path: anchor.path, line: anchor.line, side: anchor.side }
  const placed = { ...location, hunkId: anchor.hunkId ?? '' }
  return findingLine(pull, placed) ? placed : undefined
}

/** The file and line a code anchor on this PR points at, to scroll the diff there. */
export function anchorLine(anchor: Anchor) {
  return anchor.kind === 'change' || anchor.kind === 'context'
    ? { path: anchor.path, line: anchor.line, side: anchor.side }
    : undefined
}

/** Where a finding points, in words: `src/a.ts:12 · updated code`, `PR description`. */
export function anchorLabel(anchor: Anchor): string {
  if (anchor.kind === 'stack') return `PR #${String(anchor.pull)} · ${anchorLabel(anchor.location)}`
  if (anchor.kind === 'description') return `PR ${anchor.field}`
  const version = anchor.side === DiffSide.left ? 'original' : 'updated'
  const unchanged = anchor.kind === 'context' ? ', unchanged' : ''
  return `${anchor.path}:${String(anchor.line)} · ${version} code${unchanged}`
}
