// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import { Provider } from '../shared/domain/types'
import { App } from '../src/app/App'
import { call } from '../src/lib/api'
import { useLinusSession } from '../src/features/linus/useLinusSession'
import type { ReviewWorkspace } from '../src/features/review/ReviewWorkspace'
import { fixturePull } from './fixtures/pull'

const pull = fixturePull()
const repository = `${pull.owner}/${pull.repo}`
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const job = {
  session: undefined,
  loading: false,
  busy: false,
  error: '',
  act: vi.fn(),
  reload: vi.fn(),
}
const recommendation = {
  sessionId: 'saved-linus',
  createdAt: '',
  url: pull.url,
  number: pull.number,
  headSha: pull.headSha,
  verdict: 'keep',
  recommendationCount: 1,
}
const bobReview = {
  sessionId: 'saved-bob',
  createdAt: '',
  url: pull.url,
  number: pull.number,
  headSha: pull.headSha,
  verdict: 'changes',
  findingCount: 1,
}

vi.mock('../src/lib/api', async (original) => ({ ...(await original()), call: vi.fn() }))
vi.mock('../src/lib/usePreferences', () => ({
  usePreferences: () => ({
    preferences: { organization: model },
    preferencesError: '',
    reload: vi.fn(),
  }),
}))
vi.mock('../src/lib/useApiQuery', () => ({
  useApiQuery: (route: { path: string }) => ({
    data: route.path === '/bob/reviews' ? { reviews: [bobReview] } : undefined,
  }),
}))
vi.mock('../src/features/inbox/useInbox', () => ({
  useInbox: () => ({
    inbox: {
      viewer: pull.author,
      pulls: [
        { ...pull, updatedAt: '2026-10-01', labels: [], isDraft: false, reviewRequested: false },
      ],
    },
    inboxLoading: false,
    inboxStatusLoading: false,
  }),
}))
vi.mock('../src/features/linus/useLinusRecommendations', () => ({
  useLinusRecommendations: () => ({ recommendations: [recommendation] }),
}))
vi.mock('../src/features/linus/useLinusSession', () => ({ useLinusSession: vi.fn() }))
vi.mock('../src/features/bob/useBobSession', () => ({ useBobSession: () => job }))
vi.mock('../src/features/review/usePullReview', () => ({
  usePullReview: (route: { kind: string }) => ({ pull: route.kind === 'pull' ? pull : undefined }),
}))
vi.mock('../src/features/review/ReviewWorkspace', () => ({
  ReviewWorkspace: (props: ComponentProps<typeof ReviewWorkspace>) =>
    createElement(
      'div',
      null,
      props.reviewActions,
      props.renderCompanion?.({
        draft: { comments: [], summary: '', viewedFileIds: [] },
        setDraft: vi.fn(),
        ready: true,
        openReview: vi.fn(),
        focusLine: vi.fn(),
      }),
    ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useLinusSession).mockReturnValue(job)
  vi.mocked(call).mockImplementation((route) => {
    if (route === routes.startBob || route === routes.startLinus)
      return Promise.resolve({ id: 'new-review' })
    return Promise.resolve({ results: [] })
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

function openPage(path = `/repos/${repository}/pulls?inbox=mine`) {
  render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)))
}
async function choose(companion: 'Uncle Bob' | 'Linus') {
  fireEvent.click(screen.getByRole('button', { name: `Start review of PR #${pull.number}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(companion) }))
}

describe('Review entry points', () => {
  it.each(['mine', 'others', 'requested'])('keeps both companions off the %s inbox', (filter) => {
    openPage(`/repos/${repository}/pulls?inbox=${filter}`)
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    expect(call).not.toHaveBeenCalled()
    expect(Boolean(screen.queryByRole('button', { name: /Start review/ }))).toBe(filter === 'mine')
  })

  it.each(['Uncle Bob', 'Linus'] as const)(
    'starts %s on the selected PR from My PRs',
    async (companion) => {
      openPage()
      await choose(companion)
      await waitFor(() => {
        expect(call).toHaveBeenCalledWith(
          companion === 'Uncle Bob' ? routes.startBob : routes.startLinus,
          { body: { repository, urls: [pull.url] } },
        )
      })
      expect(
        await screen.findByRole('complementary', { name: new RegExp(`${companion}.*companion`) }),
      ).toBeTruthy()
      if (companion === 'Linus')
        expect(useLinusSession).toHaveBeenCalledWith(repository, 'new-review')
      fireEvent.click(screen.getByRole('button', { name: `Close ${companion}` }))
      await waitFor(() => {
        expect(
          screen.queryByRole('complementary', { name: new RegExp(`${companion}.*companion`) }),
        ).toBeNull()
      })
    },
  )

  it('starts Uncle Bob directly on the single PR in the diff', async () => {
    openPage(`/repos/${repository}/pulls/${pull.number}?inbox=mine&group=permissions&diff=split`)
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Start review of PR #${pull.number}` }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(
      await screen.findByRole('complementary', { name: 'Uncle Bob code review companion' }),
    ).toBeTruthy()
    expect(call).toHaveBeenCalledWith(routes.startBob, {
      body: { repository, urls: [pull.url] },
    })
    expect(call).not.toHaveBeenCalledWith(routes.startLinus, expect.anything())
  })

  it('reopens Uncle Bob from a saved badge after closing the panel', async () => {
    openPage()
    fireEvent.click(screen.getByRole('button', { name: /Open saved Uncle Bob review/ }))
    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Uncle Bob' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Close Uncle Bob' })).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /Open saved Uncle Bob review/ }))
    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
    expect(call).not.toHaveBeenCalledWith(routes.startBob, expect.anything())
  })

  it('reports a failed start without opening a companion and allows retry', async () => {
    vi.mocked(call).mockRejectedValueOnce(new Error('Choose a primary model first.'))
    openPage()
    await choose('Uncle Bob')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Choose a primary model first.')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    await choose('Uncle Bob')
    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
  })
})
