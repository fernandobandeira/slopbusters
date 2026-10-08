// @vitest-environment happy-dom
import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffSide, Provider, type PullRequest, type ReviewDraft } from '../shared/domain/types'
import { ReviewWorkspace } from '../src/features/review/ReviewWorkspace'
import { fixturePull } from './fixtures/pull'
import type { PullStatus } from '../shared/domain/pullStatus'

const pull = { ...fixturePull(), groupingSource: Provider.codex, isDraft: true }
const feedback: ReviewDraft = {
  comments: [
    {
      id: 'note',
      body: 'Check this permission',
      path: 'src/access/permissions.ts',
      line: 3,
      side: DiffSide.right,
      headSha: pull.headSha,
    },
  ],
  summary: 'Follow up on permissions',
  viewedFileIds: [],
}
let savedDraft: ReviewDraft

vi.mock('../src/features/review/useReviewDraft', () => ({
  useReviewDraft: () => {
    const [draft, setDraft] = useState(savedDraft)
    return { draft, setDraft, ready: true, flush: vi.fn() }
  },
}))
vi.mock('../src/features/review/useOrganizeJob', () => ({
  useOrganizeJob: () => ({ organizing: false }),
}))
vi.mock('../src/features/pull-status/usePullUpdates', () => ({
  usePullUpdates: () => ({ hasUpdates: false }),
}))
vi.mock('../src/features/stacks/usePullStack', () => ({
  usePullStack: () => ({}),
}))
vi.mock('../src/features/review/discussions/useDiscussions', () => ({
  useDiscussions: () => ({ refreshDiscussions: vi.fn(), setDiscussionError: vi.fn() }),
}))
vi.mock('../src/features/review/ReviewDiffViewer', () => ({
  ReviewDiffViewer: () => createElement('div', null, 'Code changes'),
}))
vi.mock('../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => ({ contents: new Map(), load: vi.fn(async () => {}), error: vi.fn() }),
}))
vi.mock('../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'github-dark', resolvedTheme: 'dark' }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openWorkspace(draft: ReviewDraft = { comments: [], summary: '', viewedFileIds: [] }) {
  savedDraft = draft
  const onUpdate = vi.fn()
  function Workspace() {
    const [current, setPull] = useState<PullRequest>(pull)
    return (
      <ReviewWorkspace
        pull={current}
        onUpdate={(updated) => {
          onUpdate(updated)
          setPull(updated)
        }}
        onReload={vi.fn()}
        reloading={false}
        inboxUrl="/"
      />
    )
  }
  render(
    <MemoryRouter>
      <Workspace />
    </MemoryRouter>,
  )
  return { onUpdate }
}

function mockRequests(readyResponse: () => Promise<Response>) {
  let isDraft = true
  const fetch = vi.fn((url: string) => {
    if (url.endsWith('/ready'))
      return readyResponse().then((response) => {
        if (response.ok) isDraft = false
        return response
      })
    if (url.endsWith('/status'))
      return Promise.resolve(
        Response.json({
          state: 'open',
          readiness: isDraft ? 'not-ready' : 'ready',
          reasons: isDraft ? ['This pull request is a draft.'] : [],
          mergeState: 'CLEAN',
          mergeable: 'MERGEABLE',
          reviewDecision: null,
          requiredApprovals: 0,
          requiresCodeOwnerReviews: false,
          requirementsKnown: true,
          checksState: 'SUCCESS',
          checks: [],
          reviewers: [],
          warnings: [],
          headSha: pull.headSha,
          baseSha: pull.baseSha,
          isDraft,
        } satisfies PullStatus),
      )
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('draft PR action in the review workspace', () => {
  it('marks a PR ready with no comments and refreshes status before offering review submission', async () => {
    const fetch = mockRequests(() => Promise.resolve(Response.json({ ...pull, isDraft: false })))
    const { onUpdate } = openWorkspace()
    expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready for review' }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ ...pull, isDraft: false })
    })
    expect(await screen.findByText('Pull request marked ready for review.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Submit review' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(
      `/api/pulls/${pull.id}/ready`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/status')).length).toBeGreaterThan(1)
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/reviews'))).toBe(false)
  })

  it('retains comments and summary for copying or later submission', async () => {
    mockRequests(() => Promise.resolve(Response.json({ ...pull, isDraft: false })))
    openWorkspace(feedback)
    expect(screen.getByRole('button', { name: 'Copy feedback' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready for review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit review' }))
    expect(await screen.findByLabelText('Submission summary')).toHaveProperty(
      'value',
      feedback.summary,
    )
    expect(screen.getByText('Check this permission')).toBeTruthy()
  })

  it('disables duplicate clicks and allows retry after a rejected ready request', async () => {
    let respond!: (response: Response) => void
    const fetch = mockRequests(
      () =>
        new Promise((resolve) => {
          respond = resolve
        }),
    )
    const { onUpdate } = openWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready for review' }))
    const pending = screen.getByRole('button', { name: 'Marking ready…' })
    expect(pending).toHaveProperty('disabled', true)
    fireEvent.click(pending)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/ready'))).toHaveLength(1)
    respond(Response.json({ error: 'You cannot mark this PR ready.' }, { status: 403 }))
    expect(await screen.findByText('You cannot mark this PR ready.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark ready for review' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
