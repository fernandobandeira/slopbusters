// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import type { ApiContract } from '../shared/api/contract'
import type { PanelSession } from '../shared/domain/panel'
import { Provider } from '../shared/domain/types'
import { PullPanelActions } from '../src/app/PullPanelActions'
import { call } from '../src/lib/api'
import { fixturePanelAdvice } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  call: vi.fn(),
}))

const pull = fixturePull()

function panel(status: PanelSession['status']): PanelSession {
  return {
    id: 'panel-1',
    repository: 'review-room/example',
    urls: [pull.url],
    model: { provider: Provider.claude, model: 'claude-opus-5-5' },
    reviewers: [
      { id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 },
      { id: 'terminator', name: 'Terminator', maxFindings: 10 },
    ],
    status,
    progress: 'Terminator finished; waiting on Uncle Bob.',
    createdAt: '',
    results: [],
    pending: {
      pull,
      fingerprint: 'f',
      reviews: [{ reviewer: 'terminator', advice: fixturePanelAdvice() }],
    },
  }
}

function serve(latest: () => PanelSession | null) {
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.latestPanel) return Promise.resolve({ session: latest() })
    if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
}

function renderActions(props: Partial<Parameters<typeof PullPanelActions>[0]> = {}) {
  const onOpen = vi.fn()
  render(
    <MemoryRouter>
      <PullPanelActions repository="review-room/example" pull={pull} onOpen={onOpen} {...props} />
    </MemoryRouter>,
  )
  return onOpen
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('the PR header while a panel works on the PR', () => {
  it('replaces the picker with the reviewing faces, which reopen the running panel', async () => {
    serve(() => panel('running'))
    const onOpen = renderActions()

    const button = await screen.findByRole('button', { name: /^Open the review panel on PR/ })
    fireEvent.click(button)

    expect(button.textContent).toContain('Panel reviewing…')
    expect(screen.getByRole('img', { name: 'Uncle Bob and Terminator, reviewing' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Ask the review panel/ })).toBeNull()
    expect(onOpen).toHaveBeenCalledWith('panel-1')
  })

  it('opens the running panel when the PR list asks for the panel', async () => {
    serve(() => panel('running'))
    const onOpen = renderActions({ asking: true })

    await screen.findByRole('button', { name: /^Open the review panel on PR/ })

    expect(onOpen).toHaveBeenCalledWith('panel-1')
    expect(screen.queryByText(/^Who should review/)).toBeNull()
  })

  it('offers the picker again once the panel finishes, and reports that it settled', async () => {
    vi.useFakeTimers()
    let status: PanelSession['status'] = 'running'
    serve(() => panel(status))
    const onSettled = vi.fn()
    renderActions({ onSettled })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Panel reviewing…')).toBeTruthy()

    status = 'complete'
    await act(() => vi.advanceTimersByTimeAsync(2500))

    expect(screen.getByRole('button', { name: /^Ask the review panel/ })).toBeTruthy()
    expect(onSettled).toHaveBeenCalledOnce()
  })
})
