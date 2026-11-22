// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import type { StackReviewSession } from '../../../../shared/domain/stackReview'
import { Provider } from '../../../../shared/domain/types'
import { StackReview } from '../../../../src/features/stack-review/StackReview'
import { call } from '../../../../src/lib/api'
import { finishedStackReview, layerUrl, stackEntry } from '../../../fixtures/stackReview'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

const finished = finishedStackReview([
  stackEntry(201, 'g1'),
  stackEntry(203, 'g2', { disposition: 'ask', question: 'Keep the column?' }),
])
const running: StackReviewSession = {
  ...finished,
  status: 'running',
  progress: 'Running the panel on the layers without an up-to-date review…',
  input: undefined,
  pass: undefined,
  layers: finished.layers.map((layer, index) => ({
    ...layer,
    state: index ? 'reviewing' : 'reused',
  })),
}

function renderStrip() {
  const onOpen = vi.fn()
  render(
    <MemoryRouter>
      <StackReview
        url={layerUrl(202)}
        reviewers={[{ id: 'unclebob', providers: [Provider.codex] }]}
        openPath="/review"
        onOpen={onOpen}
      />
    </MemoryRouter>,
  )
  return onOpen
}

describe('stack review strip', () => {
  it('starts with the picked reviewers, shows progress, then opens the separate review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let session = running
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.latestStackReview) return Promise.resolve({ session: null })
      if (route === routes.startStackReview) return Promise.resolve(running)
      if (route === routes.getStackReview) return Promise.resolve(session)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    const onOpen = renderStrip()
    const start = screen.getByRole('button', { name: 'Review the whole stack' })
    await waitFor(() => {
      expect(start.hasAttribute('disabled')).toBe(false)
    })
    expect(
      screen.getByText('Review every layer with the panel, then read them together.'),
    ).toBeTruthy()

    fireEvent.click(start)
    expect(await screen.findAllByText('The panel is reviewing it.')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(call).toHaveBeenCalledWith(routes.startStackReview, {
      body: { url: layerUrl(202), reviewers: [{ id: 'unclebob', providers: [Provider.codex] }] },
    })

    session = finished
    await act(() => vi.advanceTimersByTimeAsync(2000))
    const open = await screen.findByRole('link', { name: 'Open review' })
    expect(open.getAttribute('href')).toBe('/review')
    expect(screen.getByRole('status').textContent).toBe(
      'Review complete · 1 question needs you · 1 fix ready',
    )
    expect(screen.getByRole('button', { name: 'Review again' })).toBeTruthy()
    expect(screen.queryByText('Keep the column?')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()

    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it.each(['partial', 'failed', 'cancelled'] as const)('retries a %s review', async (status) => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.latestStackReview)
        return Promise.resolve({
          session: { ...running, status, progress: 'Stack review stopped.' },
        })
      if (route === routes.retryStackReview) return Promise.resolve(running)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    renderStrip()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry the stack review' }))

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(call).toHaveBeenCalledWith(routes.retryStackReview, { params: { id: 'stack-1' } })
  })
})
