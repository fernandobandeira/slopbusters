import type { LayerSnapshot } from '../../../shared/domain/anchors'
import type { PullRequest } from '../../../shared/domain/types'
import { writeEvidenceFolder, type EvidenceFolder } from '../../adapters/evidenceFolder'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { IncludedFolder } from '../../adapters/t3Engine/engineTurns'
import { logError, publicError } from '../../errors'
import { reviewEvidence } from '../../reviewSnapshot'

/** Where a model pass finds the other layers' whole diffs, one file per layer, by PR number. */
export const STACK_FOLDER = '.slopbusters/stack'
/** Where grounding finds the source at the head of the stack's top layer. */
export const STACK_TOP_FOLDER = `${STACK_FOLDER}/top`

/** What a round supplies a PR's model passes about the other layers of its stack, as files. */
export interface StackFolders {
  /** The folder holding each other loaded layer's whole diff; absent when it could not be written. */
  layers?: string
  /** The stack's top open layer, when the reviewed PR is below it, and its checkout if it opened. */
  top?: { number: number; checkout?: ReviewCheckout; error?: string }
}

/** `.slopbusters/stack/131.json`, where a model pass reads layer #131's whole diff. */
export function layerFile(pull: number): string {
  return `${STACK_FOLDER}/${layerFileName(pull)}`
}

function layerFileName(pull: number) {
  return `${String(pull)}.json`
}

/**
 * Each loaded layer's whole review evidence, written as a file a pass can read in parts. Without
 * the folder, passes see only the diffs that fit their prompts, and the round says so.
 */
export async function writeLayerFiles(
  layers: readonly LayerSnapshot[],
): Promise<EvidenceFolder | undefined> {
  if (!layers.length) return undefined
  try {
    return await writeEvidenceFolder(
      layers.map(({ pull }) => ({
        name: layerFileName(pull.number),
        text: reviewEvidence(pull, 1),
      })),
    )
  } catch (error) {
    logError('Writing the stack layers for the panel', error)
    return undefined
  }
}

/**
 * The checkout of the stack's top layer, opened the way the reviewed PR's is. One that is not
 * loaded or cannot be opened leaves grounding without it, with the reason.
 */
export async function openStackTop(
  open: ((pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>) | undefined,
  top: { number: number; pull?: PullRequest } | undefined,
  signal: AbortSignal,
): Promise<StackFolders['top']> {
  if (!open || !top) return undefined
  const { number, pull } = top
  if (!pull) return { number, error: 'the layer did not load' }
  try {
    return { number, checkout: await open(pull, signal) }
  } catch (error) {
    signal.throwIfAborted()
    return { number, error: publicError(error, 'Source could not be prepared.') }
  }
}

/** The folders a pass copies beside its working files: the layer diffs, and the top when given. */
export function stackIncludes(stack: StackFolders): IncludedFolder[] {
  return [
    ...(stack.layers ? [{ directory: stack.layers, as: STACK_FOLDER }] : []),
    ...(stack.top?.checkout
      ? [{ directory: stack.top.checkout.directory, as: STACK_TOP_FOLDER }]
      : []),
  ]
}
