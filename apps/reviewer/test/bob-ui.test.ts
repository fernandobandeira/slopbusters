// @vitest-environment happy-dom
import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BobCompanion } from '../src/features/bob/BobCompanion'
import { useBobSession } from '../src/features/bob/useBobSession'
import { BobTour } from '../src/features/bob/BobTour'
import { BobReviewBadge } from '../src/features/bob/BobReviewBadge'
import { BobText } from '../src/features/bob/BobText'
import type { BobResult } from '../shared/domain/bob'
import { Provider, type ReviewDraft } from '../shared/domain/types'
import { fixtureBobAdvice } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/features/bob/useBobSession', () => ({ useBobSession: vi.fn() }))
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
    context: {
      pull: stale ? { ...result.pull, baseSha: 'changed' } : result.pull,
      draft,
      setDraft,
      ready: true,
      openReview: vi.fn(),
      focusLine: vi.fn(),
    },
  })
}

describe('Uncle Bob tour navigation and readability', () => {
  it('focuses the existing diff on a finding and clears it when minimized', () => {
    const focusLine = vi.fn()
    vi.mocked(useBobSession).mockReturnValue({
      session: {
        id: 'saved',
        repository: 'review-room/example',
        urls: [result.pull.url],
        primary: { provider: Provider.codex, model: 'codex' },
        companion: { provider: Provider.claude, model: 'claude' },
        status: 'complete',
        progress: '',
        createdAt: '',
        results: [result],
      },
      loading: false,
      busy: false,
      error: '',
      act: vi.fn(),
      reload: vi.fn(),
    })
    render(
      createElement(BobCompanion, {
        replaySessionId: 'saved',
        pull: result.pull,
        draft: { comments: [], summary: '', viewedFileIds: [] },
        setDraft: vi.fn(),
        ready: true,
        openReview: vi.fn(),
        focusLine,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(focusLine).toHaveBeenLastCalledWith(result.advice.findings[0])
    expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Uncle Bob finding evidence' })).toBeNull()
    expect(screen.getByText('Suggested improvement')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Uncle Bob' }))
    expect(focusLine).toHaveBeenLastCalledWith(undefined)
    expect(screen.queryByRole('complementary', { name: /Uncle Bob.*companion/ })).toBeNull()
  })
  it('opens the requested saved review from its listing badge and marks a changed revision', () => {
    const onOpen = vi.fn()
    render(
      createElement(BobReviewBadge, {
        review: {
          sessionId: 'saved',
          createdAt: '',
          url: result.pull.url,
          number: result.pull.number,
          headSha: result.pull.headSha,
          verdict: 'changes',
          findingCount: 1,
        },
        headSha: 'changed',
        onOpen,
      }),
    )
    const badge = screen.getByRole('button', {
      name: /Open saved Uncle Bob review.*changed after Uncle Bob/,
    })
    expect(badge.textContent).toBe('1')
    fireEvent.click(badge)
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('renders code identifiers, paragraphs and suggestions as readable Markdown without HTML', () => {
    const view = render(
      createElement(BobText, {
        children:
          'Reuse `createProvisionedAccount()`.\n\n- Arrange the account\n- Assert the balance\n\n```ts\nawait provision(account)\n```\n<script>alert(1)</script>',
      }),
    )

    expect(screen.getByText('createProvisionedAccount()').tagName).toBe('CODE')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(view.container.querySelector('pre code')?.textContent).toContain(
      'await provision(account)',
    )
    expect(view.container.querySelector('script')).toBeNull()
  })
})

describe('Uncle Bob comment collection during the tour', () => {
  it('opens the requested review with the supplied portraits', () => {
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
        replaySessionId: 'saved',
        pull: result.pull,
        draft: { comments: [], summary: '', viewedFileIds: [] },
        setDraft: vi.fn(),
        ready: true,
        openReview: vi.fn(),
        focusLine: vi.fn(),
      }),
    )
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
    expect(screen.getByText(/changed after Uncle Bob/)).toBeTruthy()
  })
})
