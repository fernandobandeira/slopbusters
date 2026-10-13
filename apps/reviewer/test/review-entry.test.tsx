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
import { App } from '../src/app/App'
import { call } from '../src/lib/api'
import { useLinusSession } from '../src/features/linus/useLinusSession'
import type { ReviewWorkspace } from '../src/features/review/ReviewWorkspace'
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
  return render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)))
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

describe('Uncle Bob action in the diff view', () => {
  it('starts Uncle Bob directly on the single PR in the diff', async () => {
    savedReviews = []
    openPage(`/repos/${repository}/pulls/${pull.number}?inbox=mine&group=permissions&diff=split`)
    expect(screen.queryByRole('complementary', { name: /companion/ })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: `Ask Uncle Bob to review PR #${pull.number}` }),
    )
    expect(screen.queryByRole('menu')).toBeNull()
    expect(
      await screen.findByRole('complementary', { name: 'Uncle Bob code review companion' }),
    ).toBeTruthy()
    expect(call).toHaveBeenCalledWith(routes.startBob, {
      body: { repository, urls: [pull.url] },
    })
    expect(call).not.toHaveBeenCalledWith(routes.startLinus, expect.anything())
  })

  it.each([
    { findingCount: 1, headSha: pull.headSha },
    { findingCount: 0, headSha: pull.headSha },
    { findingCount: 3, headSha: 'previous-head' },
  ])('reopens the saved review instead of starting another (%j)', async (review) => {
    savedReviews = [{ ...bobReview, ...review }]
    openPage(`/repos/${repository}/pulls/${pull.number}`)
    const button = screen.getByRole('button', { name: /Open saved Uncle Bob review/ })
    expect(button.textContent).toBe(`Ask Uncle Bob${review.findingCount}`)
    expect(button.querySelector('img')?.getAttribute('src')).toBe('/unclebob/neutral.png')
    expect(screen.queryByRole('button', { name: /Ask Uncle Bob to review/ })).toBeNull()

    fireEvent.click(button)

    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
    expect(useBobSession).toHaveBeenLastCalledWith(repository, pull.url, bobReview.sessionId)
    expect(call).not.toHaveBeenCalledWith(routes.startBob, expect.anything())
  })

  it('waits for saved reviews before allowing a new review', () => {
    savedReviews = []
    savedReviewsLoading = true
    openPage(`/repos/${repository}/pulls/${pull.number}`)
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: /Ask Uncle Bob to review/,
    })

    expect(button.disabled).toBe(true)
    expect(call).not.toHaveBeenCalledWith(routes.startBob, expect.anything())
  })

  it('keeps the face visible and prevents another request while a new review is starting', async () => {
    savedReviews = []
    let finish!: (value: { id: string }) => void
    vi.mocked(call).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    openPage(`/repos/${repository}/pulls/${pull.number}`)
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: /Ask Uncle Bob to review/,
    })
    fireEvent.click(button)

    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Asking Uncle Bob…')
    expect(button.querySelector('img')?.getAttribute('src')).toBe('/unclebob/neutral.png')
    finish({ id: 'new-review' })
    expect(await screen.findByRole('button', { name: 'Close Uncle Bob' })).toBeTruthy()
  })
})
