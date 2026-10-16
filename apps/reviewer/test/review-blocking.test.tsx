// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import { Provider } from '../shared/domain/types'
import { useApiQuery } from '../src/lib/useApiQuery'
import { useBobSession } from '../src/features/bob/useBobSession'
import { App } from '../src/app/App'
import { call } from '../src/lib/api'
import type { ReviewWorkspace } from '../src/features/review/ReviewWorkspace'
import { fixturePull } from './fixtures/pull'

const pull = fixturePull()
const repository = `${pull.owner}/${pull.repo}`
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }

vi.mock('../src/lib/api', async (original) => ({ ...(await original()), call: vi.fn() }))
vi.mock('../src/lib/usePreferences', () => ({
  usePreferences: () => ({
    preferences: { organization: model },
    preferencesError: '',
    save: vi.fn(),
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
  useLinusRecommendations: () => ({ recommendations: [] }),
}))
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

/** A saved review, such as the partial one that hid itself while blocking PR #5220. */
function blockingReview(status: 'running' | 'partial' | 'complete', url = pull.url) {
  return {
    id: 'blocking-review',
    repository,
    urls: [url],
    primary: model,
    companion: { provider: Provider.claude, model: 'claude-opus-5-5' },
    status,
    progress:
      status === 'partial'
        ? 'One reviewer failed. Retry both reviewers or continue with the available review.'
        : 'Two reviewers are looking at the PR…',
    error: status === 'partial' ? 'Companion unavailable' : undefined,
    createdAt: '2026-10-13T15:27:58.459Z',
    results: [],
  }
}
function savedLatestLinus(session?: ReturnType<typeof blockingReview>) {
  vi.mocked(useApiQuery).mockImplementation((route) => ({
    data:
      route === routes.latestLinus
        ? { session: session ?? null }
        : route === routes.savedBobReviews
          ? { reviews: [] }
          : undefined,
    error: undefined,
    loading: false,
    setData: vi.fn(),
    reload: vi.fn(),
  }))
}
function CurrentPath() {
  return createElement('output', { 'aria-label': 'Current path' }, useLocation().pathname)
}
function openPage(path = `/repos/${repository}/pulls?inbox=mine`) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(App),
      createElement(CurrentPath),
    ),
  )
}
async function choose(companion: 'Linus') {
  fireEvent.click(screen.getByRole('button', { name: `Start review of PR #${pull.number}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(companion) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  savedLatestLinus()
  vi.mocked(useBobSession).mockReturnValue({
    session: undefined,
    loading: false,
    busy: false,
    error: '',
    act: vi.fn(),
    reload: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('A Linus review that blocks a new one', () => {
  it('opens the partial Linus review with its choices instead of a dead-end error', async () => {
    const partial = blockingReview('partial')
    vi.mocked(call).mockImplementation((route) => {
      if (route === routes.startLinus)
        return Promise.reject(
          new Error(
            'Finish or cancel the current Linus review of PR #128 before starting another.',
          ),
        )
      if (route === routes.latestLinus) return Promise.resolve({ session: partial })
      if (route === routes.getLinus || route === routes.retryLinus) return Promise.resolve(partial)
      return Promise.resolve({ results: [] })
    })
    openPage()
    expect(screen.queryByRole('complementary', { name: 'Linus PR companion' })).toBeNull()

    await choose('Linus')

    const companion = await screen.findByRole('complementary', { name: 'Linus PR companion' })
    expect(await screen.findByRole('button', { name: 'Retry both' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use available review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel review' })).toBeTruthy()
    expect(companion.textContent).toContain('One reviewer couldn’t finish PR #128.')
    expect(companion.textContent).toContain('Companion unavailable')
    expect(screen.getByRole('alert').textContent).toContain(
      'Linus’s review of PR #128 is waiting on you, so it is open now.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry both' }))
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.retryLinus, { params: { id: partial.id } })
    })
  })

  it('shows a partial Linus review again after the app reloads, until it is closed', async () => {
    const partial = blockingReview('partial')
    savedLatestLinus(partial)
    vi.mocked(call).mockImplementation((route) =>
      Promise.resolve(route === routes.getLinus ? partial : { results: [] }),
    )
    openPage(`/repos/${repository}/pulls/${pull.number}`)

    expect(await screen.findByRole('button', { name: 'Retry both' })).toBeTruthy()
    expect(useApiQuery).toHaveBeenCalledWith(
      routes.latestLinus,
      { query: { repository } },
      { enabled: true },
    )
    expect(call).not.toHaveBeenCalledWith(routes.startLinus, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Close Linus' }))
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Linus PR companion' })).toBeNull()
    })
  })

  it('leaves Linus closed when the latest review no longer waits on the user', () => {
    savedLatestLinus(blockingReview('complete'))
    openPage()
    expect(screen.queryByRole('complementary', { name: 'Linus PR companion' })).toBeNull()
  })

  it('keeps the original error when nothing blocks the start', async () => {
    vi.mocked(call).mockImplementation((route) =>
      route === routes.startLinus
        ? Promise.reject(new Error('Choose your primary model in Settings first.'))
        : Promise.resolve({ session: null }),
    )
    openPage()

    await choose('Linus')

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Choose your primary model in Settings first.',
      )
    })
    expect(screen.queryByRole('complementary', { name: 'Linus PR companion' })).toBeNull()
  })
})
