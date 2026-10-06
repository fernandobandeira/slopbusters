// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import { call } from '../src/lib/api'
import { readRoute } from '../src/lib/routes'
import { usePullReview } from '../src/features/review/usePullReview'
import { PullLoadingState } from '../src/features/review/PullLoadingState'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/lib/api', async (original) => ({ ...(await original()), call: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function Harness() {
  const location = useLocation()
  const navigate = useNavigate()
  const review = usePullReview(readRoute(location), location.pathname, navigate, vi.fn())
  return review.pull
    ? createElement('p', null, review.pull.title)
    : createElement(PullLoadingState, {
        number: 128,
        loading: review.loading,
        error: review.pullError,
        inboxUrl: '/',
        onRetry: review.retryPull,
      })
}

describe('PR loading and retry', () => {
  it('shows one loading state and retries a failed request without reloading the app', async () => {
    const pull = fixturePull()
    window.history.replaceState(null, '', '/repos/review-room/example/pulls/128')
    vi.mocked(call)
      .mockRejectedValueOnce(new Error('GitHub could not return this PR.'))
      .mockResolvedValue(pull)
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [window.location.pathname] },
        createElement(Harness),
      ),
    )

    expect(screen.getByRole('status').textContent).toContain('grouped automatically')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'GitHub could not return this PR.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(pull.title)).toBeTruthy()
    expect(vi.mocked(call).mock.calls.filter(([route]) => route === routes.loadPull)).toHaveLength(
      2,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
