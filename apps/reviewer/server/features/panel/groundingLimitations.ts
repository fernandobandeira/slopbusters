import type { LayerSnapshot } from '../../../shared/domain/anchors'
import type { GroundingState } from '../../../shared/domain/grounding'
import type { PanelReviewer } from '../../../shared/domain/panel'
import type { PanelPending } from '../../../shared/domain/panelSession'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import { MAX_GROUNDING_TURNS } from './limits'
import { layersWithoutDiffs } from './panelReview'
import type { StackFolders } from './stackFolders'

/**
 * What the round could not cover, most fundamental first: missing source, incomplete patches,
 * seats that did not finish or may have had more, layers seen without diffs, deferred findings,
 * and entries the two models did not settle. Any of them means the PR is not called clean.
 */
export function groundingLimitations(
  state: GroundingState,
  {
    pending,
    reviewers,
    repository,
    layers,
    stack = {},
  }: {
    pending: PanelPending
    reviewers: readonly PanelReviewer[]
    repository?: ReviewCheckout
    layers: readonly LayerSnapshot[]
    stack?: StackFolders
  },
): string[] {
  const name = (id: string) => reviewers.find((seat) => seat.id === id)?.name ?? id
  const missing = pending.reviews.filter((review) => !review.advice)
  const capped = pending.reviews.filter((review) => review.advice && review.capped)
  return [
    ...(repository
      ? []
      : [
          'Repository rules and surrounding source could not be inspected; findings use the supplied diff only.',
        ]),
    ...(pending.pull.files.some((file) => file.coverage !== 'complete')
      ? ['Some patches are incomplete or unavailable; this review does not cover all changed code.']
      : []),
    ...(missing.length
      ? [
          `Not every reviewer finished; grounding saw ${String(pending.reviews.length - missing.length)} of ${String(pending.reviews.length)} reviews.`,
        ]
      : []),
    ...(capped.length
      ? [
          `${capped.map((review) => name(review.reviewer)).join(', ')} returned as many findings as allowed and may have had more.`,
        ]
      : []),
    ...stackLimitations(layers, stack),
    ...deferredLimitation(state),
    ...settlementLimitations(state),
  ]
}

/**
 * Layers whose whole diffs reached no model, which only happens when their files could not be
 * written, and a top layer whose source grounding could not read.
 */
function stackLimitations(layers: readonly LayerSnapshot[], stack: StackFolders): string[] {
  const outlines = stack.layers ? [] : layersWithoutDiffs(layers)
  const { top } = stack
  return [
    ...(outlines.length
      ? [
          `Stack layers ${outlines.map((pull) => `#${String(pull)}`).join(', ')} were too large to include whole, and their diffs could not be supplied as files; reviewers saw their titles, descriptions and file lists, not their diffs.`,
        ]
      : []),
    ...(top && !top.checkout
      ? [
          `The source of the stack's top layer, PR #${String(top.number)}, could not be opened (${top.error ?? 'unknown error'}), so grounding could not read the code above this layer.`,
        ]
      : []),
  ]
}

function deferredLimitation(state: GroundingState): string[] {
  const deferred = state.candidates.filter((candidate) => candidate.state === 'deferred').length
  if (!deferred) return []
  return [
    `The reviewers returned ${String(state.candidates.length)} findings; this round grounded ${String(state.candidates.length - deferred)} and deferred ${String(deferred)} to a later round. Deferred findings are not rejected.`,
  ]
}

function settlementLimitations(state: GroundingState): string[] {
  const resolved = state.resolved ?? []
  const count = (resolution: string) =>
    resolved.filter((entry) => entry.resolution === resolution).length
  const unsettled = resolved.filter((entry) => !entry.verdict).length
  return [
    ...(state.outcome === 'single'
      ? [
          'Only one provider was available, so no finding was checked by a second model; every entry is unverified.',
        ]
      : []),
    ...(state.outcome === 'exhausted'
      ? [
          `The models did not agree within ${String(MAX_GROUNDING_TURNS)} turns: ${String(count('disputed'))} entries are disputed and ${String(count('unverified'))} were not checked by both.`,
        ]
      : []),
    ...(unsettled
      ? [
          `${String(unsettled)} entries need evidence the models could not inspect, so they have no verdict.`,
        ]
      : []),
  ]
}
