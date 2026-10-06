// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GandalfCompanion } from '../src/features/gandalf/GandalfCompanion'
import { InboxPage } from '../src/features/inbox/InboxPage'
import { Provider, type InboxPull } from '../shared/domain/types'
import type { GandalfSession } from '../shared/domain/gandalf'

const url = 'https://github.com/example/project/pull/1'
const pull: InboxPull = {
  number: 1,
  url,
  title: 'Preserve both changes',
  author: 'alice',
  updatedAt: '',
  isDraft: false,
  headSha: 'head',
  labels: [],
  reviewRequested: false,
  status: {
    headSha: 'head',
    baseSha: 'base',
    state: 'open',
    isDraft: false,
    readiness: 'not-ready',
    reasons: ['Conflicts'],
    mergeState: 'DIRTY',
    mergeable: 'CONFLICTING',
    reviewDecision: null,
    requiredApprovals: null,
    requiresCodeOwnerReviews: null,
    requirementsKnown: false,
    checksState: null,
    checks: [],
    reviewers: [],
    warnings: [],
  },
}
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const session: GandalfSession = {
  id: 'resolution',
  repository: 'example/project',
  urls: [url],
  primary: model,
  companion: model,
  status: 'running',
  progress: 'Secondary reviewing PR #1…',
  createdAt: '',
  turns: [],
  results: [],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function companion(ready = true, onComplete = vi.fn(), onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <GandalfCompanion
        repository="example/project"
        pulls={[pull]}
        ready={ready}
        onComplete={onComplete}
        onClose={onClose}
      />
    </MemoryRouter>,
  )
}

describe('Gandalf selection and session feedback', () => {
  it('opens from the conflict subgroup with only its conflict PRs', () => {
    const choose = vi.fn()
    render(
      <MemoryRouter>
        <InboxPage
          repository="example/project"
          filter="mine"
          inbox={{ viewer: 'alice', pulls: [pull] }}
          inboxLoading={false}
          statusLoading={false}
          selectingForLinus={false}
          selectedLinusUrls={[]}
          onSelectionChange={vi.fn()}
          onFilter={vi.fn()}
          renderPullActions={() => null}
          onResolveConflicts={choose}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }))
    expect(choose).toHaveBeenCalledWith([pull])
  })
  it('shows the joke, requires a selection, uses thinking while running and happy on completion', async () => {
    let complete: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path === '/api/gandalf/latest?repository=example%2Fproject')
        return Promise.resolve(Response.json({ session: null }))
      if (options?.method === 'POST') return Promise.resolve(Response.json(session))
      return new Promise<Response>((resolve) => {
        complete = resolve
      })
    })
    vi.stubGlobal('fetch', fetch)
    const onComplete = vi.fn()
    companion(true, onComplete)
    expect(screen.getByText('You shall not pass… until these conflicts are resolved.')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(false)
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resolve PRs' }).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select PR #1 for Gandalf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve 1 PR' }))
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe('/gandalf/thinking.png')
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/gandalf',
      expect.objectContaining({
        body: JSON.stringify({ repository: 'example/project', urls: [url] }),
      }),
    )
    await waitFor(() => {
      expect(complete).toBeDefined()
    })
    complete?.(Response.json({ ...session, status: 'complete', progress: 'You may pass.' }))
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe('/gandalf/happy.png')
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('Gandalf setup and errors', () => {
  it('requires primary setup and closes without cancelling an existing running session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ session: null }))),
    )
    const close = vi.fn()
    companion(false, vi.fn(), close)
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resolve 1 PR' }).disabled).toBe(
      true,
    )
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Close Gandalf' }))
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('keeps selection available after a start failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, options?: RequestInit) =>
        Promise.resolve(
          options?.method === 'POST'
            ? Response.json({ error: 'Choose your primary model first.' }, { status: 400 })
            : Response.json({ session: null }),
        ),
      ),
    )
    companion()
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve 1 PR' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Choose your primary model')
    })
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  })
})
