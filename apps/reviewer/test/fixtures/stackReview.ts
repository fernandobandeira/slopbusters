import type {
  CrossLayerResult,
  StackEntry,
  StackPassLayer,
  StackReviewSession,
} from '../../shared/domain/stackReview'
import { Provider } from '../../shared/domain/types'

export const stackRepository = 'review-room/example'
export const layerUrl = (number: number) =>
  `https://github.com/${stackRepository}/pull/${String(number)}`

/** A grounded entry worth fixing on `layer`, as the cross-layer pass reads it. */
export function stackEntry(
  layer: number,
  id: string,
  changes: Partial<StackEntry> = {},
): StackEntry {
  return {
    id: `#${String(layer)}/${id}`,
    layer,
    title: `Finding ${id} on #${String(layer)}`,
    kind: 'defect',
    effort: 'small',
    verdict: 'legit',
    resolution: 'agreed',
    disposition: 'fix',
    rank: 1,
    triage: 'Corrects a confirmed defect.',
    followUp: false,
    reason: 'The code shows it.',
    plan: `Fix ${id}.`,
    evidence: ['src/job.ts:4'],
    destination: { pull: layer },
    origin: 'change',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

export function passLayer(number: number, changes: Partial<StackPassLayer> = {}): StackPassLayer {
  return {
    number,
    title: `Layer ${String(number)}`,
    url: layerUrl(number),
    reviewedHead: `${String(number)}aaaaaaaa`,
    reviewedBase: `base-${String(number)}`,
    files: 2,
    additions: 10,
    deletions: 3,
    read: [],
    ...changes,
  }
}

export const emptyResult: CrossLayerResult = {
  duplicates: [],
  chains: [],
  ownership: [],
  derived: [],
  structure: [],
}

/** A finished stack review of layers 201 to 203 with `entries` and the pass's `result`. */
export function finishedStackReview(
  entries: StackEntry[],
  result: CrossLayerResult = emptyResult,
  changes: Partial<StackReviewSession> = {},
): StackReviewSession {
  const numbers = [201, 202, 203]
  const judge = { provider: Provider.claude, model: 'claude-fable-5-2' }
  return {
    id: 'stack-1',
    repository: stackRepository,
    url: layerUrl(201),
    urls: numbers.map(layerUrl),
    reviewers: ['unclebob'],
    status: 'complete',
    progress: 'The stack brief is ready.',
    createdAt: '2026-11-13T10:00:00.000Z',
    layers: numbers.map((number) => ({
      url: layerUrl(number),
      number,
      title: `Layer ${String(number)}`,
      headSha: `${String(number)}aaaaaaaa`,
      baseSha: `base-${String(number)}`,
      panel: `panel-${String(number)}`,
      state: 'reused',
    })),
    input: {
      layers: numbers.map((number) => passLayer(number)),
      entries,
      left: [],
      limitations: [],
    },
    pass: {
      roles: { primary: judge },
      turns: [
        {
          role: 'primary',
          model: judge,
          summary: 'Two layers repeat one finding.',
          changed: true,
          approved: false,
          objections: [],
        },
      ],
      result,
      positions: {},
      outcome: 'agreed',
      contested: [],
    },
    ...changes,
  }
}
