// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useBobTour } from '../src/features/bob/useBobTour'
import type { BobSession } from '../shared/domain/bob'
import { Provider } from '../shared/domain/types'
import { fixtureBobAdvice, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const pull = fixturePull()
const session: BobSession = {
  id: 'emotions',
  repository: `${pull.owner}/${pull.repo}`,
  urls: [pull.url],
  primary: { provider: Provider.codex, model: 'codex' },
  companion: { provider: Provider.claude, model: 'claude' },
  status: 'complete',
  progress: '',
  createdAt: '',
  results: [{ pull, advice: fixtureBobAdvice(), fingerprint: 'saved', reviewers: [] }],
}

describe('Bob portrait emotions', () => {
  it.each([
    ['running', 'thinking'],
    ['failed', 'resigned'],
  ] as const)('shows %s job state even with a previous result', (status, emotion) => {
    const { result } = renderHook(() => useBobTour(pull, { ...session, status }))
    expect(result.current.emotion).toBe(emotion)
  })

  it('changes expression when entering and leaving a must-fix finding', () => {
    const advice = fixtureBobAdvice()
    required(advice.findings[0]).severity = 'must-fix'
    const review = { ...session, results: [{ ...required(session.results[0]), advice }] }
    const { result } = renderHook(() => useBobTour(pull, review))

    expect(result.current.emotion).toBe('neutral')
    act(() => {
      result.current.advance(1)
    })
    expect(result.current.emotion).toBe('angry')
    act(() => {
      result.current.advance(0)
    })
    expect(result.current.emotion).toBe('neutral')
  })

  it('is happy for a clean review and neutral before a review', () => {
    const advice = { ...fixtureBobAdvice(), verdict: 'clean' as const, findings: [] }
    const review = { ...session, results: [{ ...required(session.results[0]), advice }] }
    const initialProps: { review: BobSession | undefined } = { review }
    const { result, rerender } = renderHook(
      ({ review }: { review: BobSession | undefined }) => useBobTour(pull, review),
      { initialProps },
    )
    expect(result.current.emotion).toBe('happy')
    rerender({ review: undefined })
    expect(result.current.emotion).toBe('neutral')
  })
})
