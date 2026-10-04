import { linusTourStepLimit, type LinusResult, type LinusStep } from '../shared/linus'

interface LinusReviewTurn {
  result: LinusResult
  step: LinusStep
}

export function linusReviewTurns(results: LinusResult[]): LinusReviewTurn[] {
  // Saved sessions may predate the limit. Keep their full advice available for export.
  return results.flatMap((result) =>
    result.advice.steps.slice(0, linusTourStepLimit).map((step) => ({ result, step })),
  )
}
