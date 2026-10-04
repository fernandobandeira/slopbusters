import { describe, expect, it } from 'vitest'
import { linusReviewTurns } from '../src/linusReviewTurns'
import type { LinusResult } from '../shared/linus'
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

describe('Linus guided PR handoffs', () => {
  it('keeps a single PR’s evidence steps intact without an extra handoff', () => {
    const reviewed = result(1)
    expect(linusReviewTurns([reviewed])).toEqual(
      reviewed.advice.steps.map((step) => ({ result: reviewed, step })),
    )
    expect(linusReviewTurns([])).toEqual([])
  })
  it('pauses between PRs with the completed review available for copying', () => {
    const first = result(1)
    const second = result(2)
    const third = result(3)
    const turns = linusReviewTurns([first, second, third])
    expect(turns).toHaveLength(8)
    expect(turns[2]).toMatchObject({
      result: second,
      transition: first,
      step: { target: 'overview', reference: '', emotion: 'neutral' },
    })
    expect(turns[2].step.text).toContain('That’s it for PR #1.')
    expect(turns[2].step.text).toContain('Copy its recommendations')
    expect(turns[2].step.text).toContain('PR #2: Change 2')
    expect(turns[5].transition).toBe(second)
    expect(turns[7].result).toBe(third)
    expect(turns[7].transition).toBeUndefined()
  })
  it('adds a stable handoff when a running session finishes the next PR', () => {
    const first = result(1)
    const before = linusReviewTurns([first])
    const after = linusReviewTurns([first, result(2)])
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after[before.length].transition).toBe(first)
  })
})
