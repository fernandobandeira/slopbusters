// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import type { SplitSession } from '../../../../shared/domain/split'
import { Provider } from '../../../../shared/domain/types'
import { LinusCompanion } from '../../../../src/features/linus/LinusCompanion'
import { SplitCompanion } from '../../../../src/features/split/SplitCompanion'
import { call } from '../../../../src/lib/api'
import { linusSession, pull } from '../../../fixtures/chatSessions'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))
vi.mock('../../../../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'nord', setTheme: vi.fn(), error: '' }),
}))

const repository = 'review-room/example'
function split(overrides: Partial<SplitSession> = {}): SplitSession {
  return {
    id: 'split-1',
    repository,
    url: pull.url,
    number: pull.number,
    title: pull.title,
    description: '',
    headBranch: 'feature',
    baseBranch: 'main',
    headSha: pull.headSha,
    baseSha: 'merge-base',
    primary: { provider: Provider.codex, model: 'gpt-6.1-sol' },
    companion: { provider: Provider.claude, model: 'claude-opus-5-5' },
    status: 'running',
    progress: 'Secondary model reviewing the cut · turn 2…',
    createdAt: '',
    plan: [],
    units: [],
    turns: [
      {
        role: 'primary',
        round: 1,
        summary: 'Two layers.',
        issues: [],
        approved: false,
        changed: true,
      },
    ],
    layers: [
      {
        title: 'Check editor role',
        description: 'The rule.',
        units: ['u1'],
        branch: 'feature-1-check-editor-role',
        sha: 'a',
        additions: 12,
        deletions: 2,
      },
      {
        title: 'Audit updates',
        description: 'The log.',
        units: ['u2'],
        branch: 'feature-2-audit-updates',
        sha: 'b',
        additions: 30,
        deletions: 0,
      },
    ],
    verified: true,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('the split companion', () => {
  it('shows the layers as built while the models work, then the PRs once published', async () => {
    let session = split()
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.getSplit) return Promise.resolve(session)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    const onSettled = vi.fn()
    render(<SplitCompanion sessionId="split-1" onClose={vi.fn()} onSettled={onSettled} />)

    expect(await screen.findByText('Secondary model reviewing the cut · turn 2…')).toBeTruthy()
    const layers = screen.getByRole('list', { name: 'Layers' })
    expect(layers.textContent).toContain(
      '1. Check editor role · +12 −2 · feature-1-check-editor-role',
    )
    expect(layers.textContent).toContain(`The stack adds up to PR #${String(pull.number)} exactly.`)
    expect(screen.getByRole('button', { name: 'Cancel the split' })).toBeTruthy()
    expect(onSettled).not.toHaveBeenCalled()

    session = split({
      status: 'complete',
      published: true,
      progress: 'Split PR #128 into 2 PRs.',
      layers: split().layers.map((layer, index) => ({
        ...layer,
        pullUrl: `https://github.com/${repository}/pull/${String(200 + index)}`,
        pullNumber: 200 + index,
      })),
    })
    expect(await screen.findByText('Split PR #128 into 2 PRs.', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByRole('link', { name: '#201 Audit updates' }).getAttribute('href')).toBe(
      `https://github.com/${repository}/pull/201`,
    )
    expect(screen.queryByRole('button', { name: /Cancel the split|Retry the split/ })).toBeNull()
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalled()
    })
  })

  it('offers a retry after a failed split, with the models’ turns to read', async () => {
    const failed = split({
      status: 'failed',
      error: 'The models have not agreed on a cut after 8 turns.',
      progress: 'Split stopped. Nothing was published.',
    })
    vi.mocked(call).mockImplementation((route: ApiContract) =>
      route === routes.getSplit
        ? Promise.resolve(failed)
        : route === routes.retrySplit
          ? Promise.resolve(split())
          : Promise.reject(new Error('Unexpected')),
    )
    render(<SplitCompanion sessionId="split-1" onClose={vi.fn()} onSettled={vi.fn()} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Cutting and review turns · 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the split' }))

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.retrySplit, { params: { id: 'split-1' } })
    })
  })
})

describe('splitting from Linus’s review', () => {
  it('offers to split a PR Linus would cut, and opens the split once started', async () => {
    const review = linusSession()
    const started = linusSession({
      results: review.results.map((result) => ({ ...result, splitSessionId: 'split-1' })),
    })
    vi.mocked(call).mockImplementation((route: ApiContract, input) => {
      if (route === routes.getLinus) {
        const id = (input as { params: { id: string } }).params.id
        return Promise.resolve(id === review.id ? review : started)
      }
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    const onSplit = vi.fn()
    const onOpenSplit = vi.fn()
    render(
      <MemoryRouter>
        <LinusCompanion
          repository={repository}
          pulls={[]}
          sessionId={review.id}
          onSplit={onSplit}
          onOpenSplit={onOpenSplit}
        />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Split this PR' }))
    expect(onSplit).toHaveBeenCalledWith(review.results[0], review.id)

    cleanup()
    render(
      <MemoryRouter>
        <LinusCompanion
          repository={repository}
          pulls={[]}
          sessionId="linus-started"
          onSplit={onSplit}
          onOpenSplit={onOpenSplit}
        />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Open the split' }))
    expect(onOpenSplit).toHaveBeenCalledWith('split-1')
    expect(screen.queryByRole('button', { name: 'Split this PR' })).toBeNull()
  })
})
