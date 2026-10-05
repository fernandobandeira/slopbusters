// @vitest-environment happy-dom
import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BobCompanion } from '../src/features/bob/BobCompanion'
import { useBobSession } from '../src/features/bob/useBobSession'
import { BobTour } from '../src/features/bob/BobTour'
import type { BobResult } from '../shared/domain/bob'
import type { ReviewDraft } from '../shared/domain/types'
import { fixtureBobAdvice } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/features/bob/useBobSession', () => ({ useBobSession: vi.fn() }))
vi.mock('../src/features/bob/BobEvidence', () => ({ BobEvidence: () => null }))
afterEach(() => {
  cleanup()
  localStorage.clear()
})
const result: BobResult = {
  pull: fixturePull(),
  advice: fixtureBobAdvice(),
  fingerprint: 'saved',
  reviewers: [],
}
function Tour({ stale = false }: { stale?: boolean }) {
  const [draft, setDraft] = useState<ReviewDraft>({
    comments: [],
    summary: 'Existing summary',
    viewedFileIds: ['already-viewed'],
  })
  return createElement(BobTour, {
    result,
    index: 1,
    advance: vi.fn(),
    showEvidence: vi.fn(),
    context: {
      pull: stale ? { ...result.pull, baseSha: 'changed' } : result.pull,
      draft,
      setDraft,
      ready: true,
      openReview: vi.fn(),
    },
  })
}

describe('Bob comment collection during the tour', () => {
  it('invites the user to review the open PR with the supplied portraits', () => {
    const act = vi.fn()
    vi.mocked(useBobSession).mockReturnValue({
      session: undefined,
      loading: false,
      busy: false,
      error: '',
      act,
      reload: vi.fn(),
    })
    render(
      createElement(BobCompanion, {
        pull: result.pull,
        draft: { comments: [], summary: '', viewedFileIds: [] },
        setDraft: vi.fn(),
        ready: true,
        openReview: vi.fn(),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open Bob code review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review this PR' }))

    expect(act).toHaveBeenCalledWith('start', [result.pull.url])
    expect(screen.getByRole('img').getAttribute('src')).toBe('/unclebob/neutral.png')
  })
  it('saves user wording, edits the same comment without duplication and removes it', () => {
    render(createElement(Tour))
    fireEvent.click(screen.getByRole('button', { name: 'Add review comment' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Use our existing audit helper, please.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save to review draft' }))
    expect(screen.getByRole('status').textContent).toContain('saved')
    expect(screen.getByRole('button', { name: 'Review draft · 1 comment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft comment' }))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe(
      'Use our existing audit helper, please.',
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My revised comment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to review draft' }))
    expect(screen.getByRole('button', { name: 'Review draft · 1 comment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove comment' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add review comment' })).toBeTruthy()
  })
  it('blocks annotations when the current PR base differs from the saved review', () => {
    render(createElement(Tour, { stale: true }))

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Add review comment' }).disabled,
    ).toBe(true)
    expect(screen.getByText(/changed after Bob/)).toBeTruthy()
  })
})
