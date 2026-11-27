// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import { getStackRecords } from '../../../../shared/api/stackReviewRecords'
import type { PanelSession } from '../../../../shared/domain/panelSession'
import { modelFor } from '../../../../shared/domain/preferences'
import {
  crossLayerProgress,
  type StackLayer,
  type StackReviewSession,
} from '../../../../shared/domain/stackReview'
import { Provider } from '../../../../shared/domain/types'
import { renderStackReview } from '../../../../src/app/StackReviewSlot'
import { call } from '../../../../src/lib/api'
import { fixturePanelAdvice } from '../../../fixtures/panel'
import { fixturePull } from '../../../fixtures/pull'
import { finishedStackReview, layerUrl, stackEntry } from '../../../fixtures/stackReview'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

const finished = finishedStackReview([
  stackEntry(201, 'g1'),
  stackEntry(203, 'g2', { disposition: 'ask', question: 'Keep the column?' }),
])
const otherLayers = [
  'reviewed',
  'reviewed',
  'reviewed',
  'reviewed',
  'stopped',
  'waiting',
  'waiting',
] as const
const runningLayers: StackLayer[] = [
  ...finished.layers.map((layer, index): StackLayer => ({
    ...layer,
    state: index ? 'reviewing' : 'reused',
    panel: `panel-${String(layer.number)}`,
  })),
  ...otherLayers.map((state, index) => ({
    number: 204 + index,
    url: layerUrl(204 + index),
    title: `Layer ${String(204 + index)}`,
    state,
  })),
]
const running: StackReviewSession = {
  ...finished,
  status: 'running',
  reviewers: [
    { id: 'unclebob', providers: [Provider.claude] },
    { id: 'teammate:avery', providers: [Provider.codex] },
  ],
  progress: 'Running the panel on the layers without an up-to-date review…',
  input: undefined,
  pass: undefined,
  urls: runningLayers.map((layer) => layer.url),
  layers: runningLayers,
}

const avery = {
  id: 'avery',
  name: 'Avery',
  skill: 'AveryReview',
  locations: { codex: '/codex/AveryReview' },
  avatars: [],
  maxFindings: 20,
  updatedAt: '2026-10-01',
}
const panel: PanelSession = {
  id: 'panel-202',
  repository: running.repository,
  urls: [layerUrl(202)],
  model: modelFor(Provider.codex),
  reviewers: [
    { id: 'unclebob', name: 'Uncle Bob', maxFindings: 10, model: modelFor(Provider.claude) },
    { id: 'teammate:avery', name: 'Avery', maxFindings: 20, model: modelFor(Provider.codex) },
  ],
  status: 'running',
  progress: '1 of 2 reviewers finished PR #202…',
  createdAt: running.createdAt,
  results: [],
  pending: {
    pull: { ...fixturePull(), url: layerUrl(202), number: 202 },
    fingerprint: 'fingerprint',
    reviews: [{ reviewer: 'unclebob', outcome: 'completed', advice: fixturePanelAdvice() }],
  },
}

function renderStrip() {
  const onOpen = vi.fn()
  const strip = renderStackReview('mine', onOpen, Provider.codex)
  render(<MemoryRouter>{strip(layerUrl(202))}</MemoryRouter>)
  return onOpen
}

function mockProgress(latest: StackReviewSession | null = null) {
  const review = { stack: running, panel }
  vi.mocked(call).mockImplementation((route: ApiContract, input: { params?: unknown }) => {
    if (route === getStackRecords)
      return Promise.resolve({ records: [], revisions: [], applied: [] })
    if (route === routes.latestStackReview) return Promise.resolve({ session: latest })
    if (route === routes.listTeammates) return Promise.resolve({ teammates: [avery] })
    if (route === routes.startStackReview) return Promise.resolve(running)
    if (route === routes.getPanel) {
      const working =
        routes.getPanel.params.parse(input.params).id === 'panel-202'
          ? review.panel
          : {
              ...panel,
              id: 'panel-203',
              pending: undefined,
              progress: 'Waiting for panels on other PRs to finish…',
            }
      return Promise.resolve({ revision: review.panel === panel ? 1 : 2, session: working })
    }
    if (route === routes.getStackReview) return Promise.resolve({ ...review.stack })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
  return review
}

describe('stack review strip', () => {
  it('starts collapsed and polls panel details only while the layer list is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const review = mockProgress(running)
    renderStrip()
    const panelCalls = () =>
      vi.mocked(call).mock.calls.filter(([route]) => route === routes.getPanel)

    const showLayers = await screen.findByRole('button', { name: 'Show layers' })
    expect(showLayers.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('status').textContent).toBe(
      'Reviewing the stack · 5 of 10 layers done · 1 failed',
    )
    expect(screen.queryByRole('list')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(call).toHaveBeenCalledWith(routes.getStackReview, expect.anything(), expect.anything())
    expect(panelCalls()).toHaveLength(0)

    fireEvent.click(showLayers)
    const layers = screen.getByRole('list', { name: 'Layers, bottom to top' })
    expect(within(layers).getAllByRole('listitem')).toHaveLength(10)
    expect(
      await screen.findByText('1 of 2 reviewers finished · Uncle Bob (Claude) · Completed'),
    ).toBeTruthy()
    expect(panelCalls().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Hide layers' }))
    expect(screen.queryByRole('list')).toBeNull()
    const requests = panelCalls().length
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(panelCalls()).toHaveLength(requests)

    review.stack = {
      ...running,
      progress: crossLayerProgress,
      layers: running.layers.map((layer) => ({ ...layer, state: 'reviewed' })),
    }
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByRole('status').textContent).toBe('Reading every layer’s findings together…')
  })

  it('shows the layer note on its own when an existing panel has different reviewers', async () => {
    const note = 'Already being reviewed by Uncle Bob, Avery.'
    mockProgress({
      ...running,
      layers: running.layers.map((layer) => (layer.number === 202 ? { ...layer, note } : layer)),
    })
    renderStrip()

    fireEvent.click(await screen.findByRole('button', { name: 'Show layers' }))
    await screen.findByText('Panel seats · Uncle Bob (Claude), Avery (Codex)')
    expect(screen.getByText(note)).toBeTruthy()
  })

  it(
    'starts with the picked reviewers, shows progress, then opens the separate review',
    reviewAndOpen,
  )
})

async function reviewAndOpen() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const review = mockProgress()
  const onOpen = renderStrip()
  const start = screen.getByRole('button', { name: 'Review the whole stack' })
  await waitFor(() => {
    expect(start.hasAttribute('disabled')).toBe(false)
  })
  expect(
    screen.getByText('Review every layer with the panel, then read them together.'),
  ).toBeTruthy()

  fireEvent.click(start)
  expect(call).not.toHaveBeenCalledWith(routes.startStackReview, expect.anything())
  expect(await screen.findByText('Who should review this stack?')).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: /Ask Linus first/ })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Avery on Codex' }))
  fireEvent.click(screen.getByRole('button', { name: 'Uncle Bob on Claude' }))
  fireEvent.click(screen.getByRole('button', { name: 'Uncle Bob on Codex' }))
  fireEvent.click(screen.getByRole('button', { name: 'Terminator on Codex' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review with 2 reviewers' }))

  fireEvent.click(await screen.findByRole('button', { name: 'Show layers' }))
  expect(await screen.findByText('Panel seats · Uncle Bob (Claude), Avery (Codex)')).toBeTruthy()
  expect(
    screen.getByText('1 of 2 reviewers finished · Uncle Bob (Claude) · Completed'),
  ).toBeTruthy()
  expect(screen.getByText('Waiting for panels on other PRs to finish…')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  expect(call).toHaveBeenCalledWith(routes.startStackReview, {
    body: { url: layerUrl(202), reviewers: running.reviewers },
  })

  review.panel = {
    ...panel,
    progress: '0 of 2 reviewers finished PR #202…',
    pending: {
      pull: { ...fixturePull(), url: layerUrl(202), number: 202 },
      fingerprint: 'fingerprint',
      reviews: [],
    },
  }
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(await screen.findByText('0 of 2 reviewers finished…')).toBeTruthy()

  review.stack = finished
  await act(() => vi.advanceTimersByTimeAsync(2000))
  const open = await screen.findByRole('link', { name: 'Open review' })
  expect(open.getAttribute('href')).toContain('/stack-review')
  expect(screen.getByRole('status').textContent).toBe(
    'Review complete · 0 of 1 answered · 1 question needs you · 1 fix ready',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review again' }))
  expect(await screen.findByText('Who should review this stack?')).toBeTruthy()
  expect(
    (await screen.findByRole('button', { name: 'Avery on Codex' })).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(
    screen.getByRole('button', { name: 'Uncle Bob on Claude' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(
    vi.mocked(call).mock.calls.filter(([route]) => route === routes.startStackReview),
  ).toHaveLength(1)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByText('Who should review this stack?')).toBeNull()
  })
  expect(screen.queryByText('Keep the column?')).toBeNull()
  expect(screen.queryByRole('list')).toBeNull()

  fireEvent.click(open)
  expect(onOpen).toHaveBeenCalledOnce()
}

describe('stopped stack reviews and start errors', () => {
  it('shows a start error only inside the picker', async () => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.latestStackReview) return Promise.resolve({ session: null })
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [avery] })
      return Promise.reject(new Error('Could not start this review.'))
    })
    renderStrip()
    const start = screen.getByRole('button', { name: 'Review the whole stack' })
    await waitFor(() => {
      expect(start.hasAttribute('disabled')).toBe(false)
    })

    fireEvent.click(start)
    fireEvent.click(await screen.findByRole('button', { name: 'Review with 2 reviewers' }))

    const error = await screen.findByText('Could not start this review.')
    expect(screen.getByRole('dialog').contains(error)).toBe(true)
  })

  it.each(['partial', 'failed', 'cancelled'] as const)('retries a %s review', async (status) => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === getStackRecords)
        return Promise.resolve({ records: [], revisions: [], applied: [] })
      if (route === routes.latestStackReview)
        return Promise.resolve({
          session: { ...running, status, progress: 'Stack review stopped.' },
        })
      if (route === routes.retryStackReview) return Promise.resolve(running)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    renderStrip()

    expect(await screen.findByRole('button', { name: 'Review again' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the stack review' }))

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(call).toHaveBeenCalledWith(routes.retryStackReview, { params: { id: 'stack-1' } })
  })
})
