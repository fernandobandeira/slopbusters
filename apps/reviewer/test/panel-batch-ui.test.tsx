// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import type { ApiContract } from '../shared/api/contract'
import type { ActivePanel } from '../shared/domain/panel'
import { Provider } from '../shared/domain/types'
import { PanelActivityBadge } from '../src/features/panel/PanelActivityBadge'
import { PanelBatchPicker } from '../src/features/panel/PanelBatchPicker'
import { settledSince } from '../src/features/panel/useActivePanels'
import { call } from '../src/lib/api'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  call: vi.fn(),
}))

const repository = 'review-room/example'
const urlFor = (number: number) => `https://github.com/${repository}/pull/${String(number)}`

function active(number: number, changes: Partial<ActivePanel> = {}): ActivePanel {
  return {
    sessionId: `panel-${String(number)}`,
    url: urlFor(number),
    number,
    status: 'running',
    queued: false,
    progress: '1 of 2 reviewers finished…',
    reviewers: ['unclebob', 'terminator'],
    ...changes,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('asking the panel about several PRs', () => {
  it('starts the chosen reviewers on each selected PR and reports what it started', async () => {
    const started = { panels: [active(1), active(2)], skipped: [] }
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      if (route === routes.startPanels) return Promise.resolve(started)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    const onStarted = vi.fn()
    render(
      <MemoryRouter>
        <PanelBatchPicker
          repository={repository}
          urls={[urlFor(1), urlFor(2)]}
          provider={Provider.claude}
          onStarted={onStarted}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ask the review panel about 2 PRs' }))
    expect(screen.getByText('Who should review 2 PRs?')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Review with 2 reviewers' }))

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith(started)
    })
    expect(call).toHaveBeenCalledWith(routes.startPanels, {
      body: {
        repository,
        urls: [urlFor(1), urlFor(2)],
        reviewers: [
          { id: 'unclebob', providers: [Provider.claude] },
          { id: 'terminator', providers: [Provider.claude] },
        ],
      },
    })
  })
})

describe('a PR row while its panel is unfinished', () => {
  it.each([
    [active(1, { queued: true }), 'Panel queued'],
    [active(1), 'Panel reviewing'],
    [active(1, { status: 'partial' }), 'Panel needs you'],
    [active(1, { status: 'cancelled' }), 'Panel stopped'],
  ])('says where the panel is and opens it', (panel, label) => {
    const onOpen = vi.fn()
    render(<PanelActivityBadge panel={panel} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    expect(screen.getByText(label)).toBeTruthy()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('noticing a panel stop', () => {
  it('reports the panels that stopped running, and those that left the list as finished', () => {
    const before = [active(1), active(2), active(3), active(4, { status: 'partial' })]
    const now = [active(2), active(3, { status: 'partial' }), active(4, { status: 'partial' })]

    expect(settledSince(before, now)).toEqual([
      { panel: active(1), outcome: 'complete' },
      { panel: active(3), outcome: 'partial' },
    ])
  })
})
