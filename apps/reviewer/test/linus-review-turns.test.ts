import { describe, expect, it } from 'vitest'
import { linusReviewTurns } from '../src/linusReviewTurns'
import { recommendationsPrompt, type LinusResult } from '../shared/linus'
import { fixturePull } from './fixtures/pull'

function result(number: number): LinusResult {
  const pull = { ...fixturePull(), number, title: `Change ${number}` }
  return {
    pull,
    fingerprint: String(number),
    reviewers: [],
    advice: {
      verdict: 'keep',
      reasoning: 'One logical change',
      revisedTitle: '',
      revisedDescription: '',
      layers: [],
      limitations: [],
      disagreements: [],
      steps: [
        { target: 'overview', reference: '', emotion: 'happy', text: 'Keep it together.' },
        {
          target: 'diff',
          reference: pull.files[0].hunks[0].id,
          emotion: 'neutral',
          text: 'These changes belong together.',
        },
      ],
    },
  }
}

describe('Linus focused tour', () => {
  it('keeps a short single PR review intact', () => {
    const reviewed = result(1)
    expect(linusReviewTurns([reviewed])).toEqual(
      reviewed.advice.steps.map((step) => ({ result: reviewed, step })),
    )
    expect(linusReviewTurns([])).toEqual([])
  })
  it('moves directly between PRs without extra handoff screens', () => {
    const first = result(1)
    const second = result(2)
    const third = result(3)
    const turns = linusReviewTurns([first, second, third])
    expect(turns).toHaveLength(6)
    expect(turns.map((turn) => turn.result.pull.number)).toEqual([1, 1, 2, 2, 3, 3])
  })
  it('caps legacy sessions at three turns per PR while preserving full exports', () => {
    const reviews = [result(1), result(2), result(3)]
    for (const review of reviews) {
      review.advice.steps = Array.from({ length: 12 }, (_, index) => ({
        ...review.advice.steps[0],
        text: `PR ${review.pull.number} point ${index + 1}`,
      }))
    }
    const turns = linusReviewTurns(reviews)
    expect(turns).toHaveLength(9)
    expect(turns.map((turn) => turn.step.text)).not.toContain('PR 1 point 12')
    expect(recommendationsPrompt(reviews)).toContain('PR 1 point 12')
    expect(recommendationsPrompt(reviews)).toContain('PR 3 point 12')
    expect(reviews[0].advice.steps).toHaveLength(12)
  })
  it('keeps existing turns stable as another PR finishes', () => {
    const first = result(1)
    const before = linusReviewTurns([first])
    const after = linusReviewTurns([first, result(2)])
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after[before.length].result.pull.number).toBe(2)
  })
})
