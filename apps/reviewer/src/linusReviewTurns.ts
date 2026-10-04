import type { LinusResult, LinusStep } from '../shared/linus'

interface LinusReviewTurn {
  result: LinusResult
  step: LinusStep
  transition?: LinusResult
}

export function linusReviewTurns(results: LinusResult[]): LinusReviewTurn[] {
  const turns: LinusReviewTurn[] = []
  let previous: LinusResult | undefined
  for (const result of results) {
    if (!result.advice.steps.length) continue
    if (previous) {
      turns.push({
        result,
        transition: previous,
        step: {
          target: 'overview',
          reference: '',
          emotion: 'neutral',
          text: `That’s it for PR #${previous.pull.number}. Copy its recommendations if you want to apply them. Now let’s look at PR #${result.pull.number}: ${result.pull.title}.`,
        },
      })
    }
    turns.push(...result.advice.steps.map((step) => ({ result, step })))
    previous = result
  }
  return turns
}
