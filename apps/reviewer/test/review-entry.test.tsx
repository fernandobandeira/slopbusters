// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import { Provider } from '../shared/domain/types'
import type { BobReviewSummary } from '../shared/domain/bob'
import { useApiQuery } from '../src/lib/useApiQuery'
import { useBobSession } from '../src/features/bob/useBobSession'
import { usePanelSession } from '../src/features/panel/usePanelSession'
import { App } from '../src/app/App'
import { call } from '../src/lib/api'
import { useLinusSession } from '../src/features/linus/useLinusSession'
import type { ReviewPage } from '../src/app/ReviewPage'
import { fixturePull } from './fixtures/pull'
import type { Preferences } from '../shared/domain/preferences'

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
const linusJob = { ...job, sendToPanel: vi.fn(), askAgain: vi.fn() }
const recommendation = {
  sessionId: 'saved-linus',
  createdAt: '',
  url: pull.url,
  number: pull.number,
  headSha: pull.headSha,
  verdict: 'keep',
  recommendationCount: 1,
}
const bobReview: BobReviewSummary = {
  sessionId: 'saved-bob',
  createdAt: '',
  url: pull.url,
  number: pull.number,
  headSha: pull.headSha,
  verdict: 'changes',
  findingCount: 1,
}

let savedReviews = [bobReview]
let savedReviewsLoading = false
let preferences: Preferences | undefined = { organization: model }
const savePreferences = vi.fn((changes: Preferences) =>
  Promise.resolve({ ...preferences, ...changes }),
)

vi.mock('../src/lib/api', async (original) => ({ ...(await original()), call: vi.fn() }))
vi.mock('../src/lib/usePreferences', () => ({
  usePreferences: () => ({
    preferences,
    preferencesError: '',
    save: savePreferences,
    reload: vi.fn(),
  }),
}))
vi.mock('../src/lib/useApiQuery', () => ({ useApiQuery: vi.fn() }))
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
vi.mock('../src/features/bob/useBobSession', () => ({ useBobSession: vi.fn() }))
vi.mock('../src/features/panel/usePanelSession', () => ({ usePanelSession: vi.fn() }))
vi.mock('../src/features/review/usePullReview', () => ({
  usePullReview: (route: { kind: string }) => ({ pull: route.kind === 'pull' ? pull : undefined }),
}))
vi.mock('../src/app/ReviewPage', () => ({
  ReviewPage: (props: ComponentProps<typeof ReviewPage>) =>
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
  savedReviews = [bobReview]
  savedReviewsLoading = false
  preferences = { organization: model }
  vi.mocked(useApiQuery).mockImplementation((route) => ({
    data: route.path === '/bob/reviews' ? { reviews: savedReviews } : undefined,
    error: undefined,
    loading: route.path === '/bob/reviews' && savedReviewsLoading,
    setData: vi.fn(),
    reload: vi.fn(),
  }))
  vi.mocked(useBobSession).mockReturnValue(job)
  vi.mocked(useLinusSession).mockReturnValue(linusJob)
  vi.mocked(usePanelSession).mockReturnValue({ ...job, replace: vi.fn() })
  vi.mocked(call).mockImplementation((route) => {
    if (route === routes.startPanel || route === routes.startLinus)
      return Promise.resolve({ id: 'new-review' })
    return Promise.resolve({ results: [] })
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

function openPage(path = `/repos/${repository}/pulls?inbox=mine`) {
  return render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)))
}
/** Pick the PR in the list and ask Linus about it. */
async function askLinus() {
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
  fireEvent.click(screen.getByRole('checkbox', { name: `Select PR #${pull.number} for review` }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Linus about 1 PR' }))
}

describe('Review entry points', () => {
  it.each(['mine', 'others', 'requested'])('keeps both companions off the %s inbox', (filter) => {
    openPage(`/repos/${repository}/pulls?inbox=${filter}`)
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    expect(call).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Start review/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy()
  })

  it('starts Linus on the selected PRs and closes the selection', async () => {
    openPage()
    await askLinus()
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.startLinus, {
        body: { repository, urls: [pull.url] },
      })
    })
    expect(await screen.findByRole('complementary', { name: 'Linus PR companion' })).toBeTruthy()
    expect(useLinusSession).toHaveBeenCalledWith(repository, 'new-review')
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Selected PRs' })).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close Linus' }))
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Linus PR companion' })).toBeNull()
    })
  })

  it('offers the review panel beside Linus on the same selection', () => {
    openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByRole('checkbox', { name: `Select PR #${pull.number} for review` }))

    expect(screen.getByRole('button', { name: 'Ask the review panel about 1 PR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask Linus about 1 PR' })).toBeTruthy()
    expect(call).not.toHaveBeenCalledWith(routes.startPanel, expect.anything())
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
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

  it('reports a failed start without opening a companion and keeps the selection for a retry', async () => {
    vi.mocked(call).mockRejectedValueOnce(new Error('Choose a primary model first.'))
    openPage()
    await askLinus()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Choose a primary model first.')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Linus about 1 PR' }))
    expect(await screen.findByRole('button', { name: 'Close Linus' })).toBeTruthy()
  })
})

function CurrentPath() {
  return createElement('output', { 'aria-label': 'Current path' }, useLocation().pathname)
}

describe('repository startup selection', () => {
  it('waits for durable history before choosing a repository from GitHub', async () => {
    preferences = undefined
    vi.mocked(useApiQuery).mockImplementation((route) => ({
      data:
        route === routes.getRepositories
          ? { repositories: [{ fullName: 'owner/github-first', description: '', private: false }] }
          : undefined,
      error: undefined,
      loading: false,
      setData: vi.fn(),
      reload: vi.fn(),
    }))
    const app = createElement(MemoryRouter, null, createElement(App), createElement(CurrentPath))
    const view = render(app)
    expect(screen.getByLabelText('Current path').textContent).toBe('/')
    expect(savePreferences).not.toHaveBeenCalled()

    preferences = { organization: model, recentRepositories: ['owner/last', 'owner/previous'] }
    view.rerender(createElement(MemoryRouter, null, createElement(App), createElement(CurrentPath)))

    await waitFor(() => {
      expect(screen.getByLabelText('Current path').textContent).toBe('/repos/owner/last/pulls')
    })
  })

  it('prefers durable history to stale browser storage and restores its order after reopening', async () => {
    localStorage.setItem('slopbusters:repository', 'owner/stale')
    preferences = { organization: model, recentRepositories: ['owner/last', 'owner/previous'] }
    const view = openPage('/')
    expect(screen.getByRole('button', { name: 'Switch repository: owner/last' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Switch repository: owner/last' }))
    fireEvent.click(await screen.findByRole('button', { name: 'owner/previous' }))
    await waitFor(() => {
      expect(savePreferences).toHaveBeenLastCalledWith({
        recentRepositories: ['owner/previous', 'owner/last'],
      })
    })
    await window.slopbustersFlushReviews?.()
    view.unmount()
    localStorage.clear()
    preferences = { organization: model, recentRepositories: ['owner/previous', 'owner/last'] }
    openPage('/')
    expect(screen.getByRole('button', { name: 'Switch repository: owner/previous' })).toBeTruthy()
  })

  it('migrates browser history when durable history has not been saved yet', async () => {
    localStorage.setItem('slopbusters:repository', 'owner/legacy')
    openPage('/')
    expect(screen.getByRole('button', { name: 'Switch repository: owner/legacy' })).toBeTruthy()
    await waitFor(() => {
      expect(savePreferences).toHaveBeenCalledWith({ recentRepositories: ['owner/legacy'] })
    })
  })

  it('preserves an explicit repository route while restoring history', async () => {
    preferences = { organization: model, recentRepositories: ['owner/last', 'owner/previous'] }
    openPage('/repos/external/from-link/pulls')
    expect(
      screen.getByRole('button', { name: 'Switch repository: external/from-link' }),
    ).toBeTruthy()
    await waitFor(() => {
      expect(savePreferences).toHaveBeenCalledWith({
        recentRepositories: ['external/from-link', 'owner/last', 'owner/previous'],
      })
    })
  })
})

describe('Review actions in the diff view', () => {
  it('offers the review panel instead of a solo Uncle Bob review', () => {
    savedReviews = []
    openPage(`/repos/${repository}/pulls/${pull.number}?inbox=mine&group=permissions&diff=split`)

    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ask Uncle Bob to review/ })).toBeNull()
    expect(
      screen.getByRole('button', { name: `Ask the review panel about PR #${pull.number}` }),
    ).toBeTruthy()
    expect(call).not.toHaveBeenCalled()
  })

  it.each([
    { findingCount: 1, headSha: pull.headSha },
    { findingCount: 0, headSha: pull.headSha },
    { findingCount: 3, headSha: 'previous-head' },
  ])('still reopens a saved Uncle Bob review (%j)', async (review) => {
    savedReviews = [{ ...bobReview, ...review }]
    openPage(`/repos/${repository}/pulls/${pull.number}`)
    const button = screen.getByRole('button', { name: /Open saved Uncle Bob review/ })
    expect(button.textContent).toBe(String(review.findingCount))
    expect(button.querySelector('img')?.getAttribute('src')).toBe('/unclebob/neutral.png')

    fireEvent.click(button)

    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
    expect(useBobSession).toHaveBeenLastCalledWith(repository, pull.url, bobReview.sessionId)
    expect(call).not.toHaveBeenCalledWith(routes.startBob, expect.anything())
  })
})
