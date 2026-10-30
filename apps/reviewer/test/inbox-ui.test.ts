// @vitest-environment happy-dom
import { createElement, useState, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxPull } from '../shared/domain/types'
import type { PullStatus } from '../shared/domain/pullStatus'
import type { InboxChip } from '../src/features/inbox/inboxChips'
import { InboxPage } from '../src/features/inbox/InboxPage'

afterEach(cleanup)

function pull(number: number, changes: Partial<PullStatus> = {}): InboxPull {
  return {
    number,
    url: `https://github.com/example/project/pull/${number}`,
    title: `Change ${number}`,
    author: 'alice',
    createdAt: `2026-10-${String(number).padStart(2, '0')}T12:00:00Z`,
    updatedAt: '2026-10-03T12:00:00Z',
    isDraft: false,
    headSha: 'head',
    labels: [],
    reviewRequested: false,
    status: {
      headSha: 'head',
      baseSha: 'base',
      state: 'open',
      isDraft: false,
      readiness: 'ready',
      reasons: [],
      mergeState: 'CLEAN',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      requiredApprovals: 1,
      requiresCodeOwnerReviews: false,
      requirementsKnown: true,
      checksState: 'SUCCESS',
      checks: [],
      reviewers: [],
      warnings: [],
      ...changes,
    },
  }
}

function Inbox({
  pulls,
  statusLoading = false,
  chips = [],
  onChips = vi.fn(),
  purpose = 'Linus',
  actions,
}: {
  pulls: InboxPull[]
  statusLoading?: boolean
  chips?: InboxChip[]
  onChips?: (chips: InboxChip[]) => void
  purpose?: string
  actions?: ReactNode
}) {
  const [urls, onChange] = useState<string[]>([])
  return createElement(
    MemoryRouter,
    null,
    createElement(InboxPage, {
      repository: 'example/project',
      filter: 'mine',
      inbox: { viewer: 'alice', pulls },
      inboxLoading: false,
      statusLoading,
      chips,
      chipContext: { panelReviewed: () => false },
      onChips,
      selection: { purpose, urls, max: 2, onChange, actions, onCancel: vi.fn() },
      onFilter: vi.fn(),
      renderPullActions: () => null,
    }),
  )
}

const titles = () =>
  [...document.querySelectorAll('.pr-row-link strong')].map((title) => title.textContent)

describe('the PR list', () => {
  it('lists my PRs newest opened first, in one list whatever their status', () => {
    const ready = pull(1)
    const comments = pull(2, { unresolvedReviewThreads: 2 })
    const conflict = pull(3, { mergeable: 'CONFLICTING', unresolvedReviewThreads: 1 })
    const other = { ...pull(4), author: 'bob' }

    render(createElement(Inbox, { pulls: [ready, other, comments, conflict] }))

    expect(titles()).toEqual([conflict.title, comments.title, ready.title])
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('keeps a PR in place and selected when its status changes', () => {
    const conflict = pull(1, { mergeable: 'CONFLICTING' })
    const comments = pull(2, { unresolvedReviewThreads: 1 })
    const view = render(createElement(Inbox, { pulls: [conflict, comments] }))
    const checkbox = (number: number) =>
      screen.getByRole<HTMLInputElement>('checkbox', { name: `Select PR #${number} for Linus` })

    fireEvent.click(checkbox(1))
    view.rerender(createElement(Inbox, { pulls: [pull(1), comments] }))

    expect(titles()).toEqual([comments.title, conflict.title])
    expect(checkbox(1).checked).toBe(true)
    expect(checkbox(2).checked).toBe(false)
  })

  it('filters by the chips it is given and counts each chip on the tab', () => {
    const onChips = vi.fn()
    const conflict = pull(1, { mergeable: 'CONFLICTING' })
    const draft = { ...pull(2), isDraft: true }

    render(createElement(Inbox, { pulls: [conflict, draft], chips: ['draft'], onChips }))

    expect(titles()).toEqual([draft.title])
    const chips = within(screen.getByRole('group', { name: 'Show only' }))
    expect(chips.getByRole('button', { name: 'Draft (1)' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    fireEvent.click(chips.getByRole('button', { name: 'Merge conflicts (1)' }))
    expect(onChips).toHaveBeenCalledWith(['draft', 'conflicts'])
  })

  it('offers to clear chips that hide every PR', () => {
    const onChips = vi.fn()

    render(createElement(Inbox, { pulls: [pull(1)], chips: ['draft'], onChips }))

    expect(screen.getByText('No PRs match these filters')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onChips).toHaveBeenCalledWith([])
  })

  it('picks the shown PRs for the panel up to its limit and shows its actions', () => {
    render(
      createElement(Inbox, {
        pulls: [pull(1), pull(2), pull(3)],
        purpose: 'the panel',
        actions: createElement('button', null, 'Ask the panel'),
      }),
    )
    const bar = within(screen.getByRole('region', { name: 'Selected PRs' }))

    fireEvent.click(bar.getByRole('button', { name: 'Select shown (first 2)' }))

    expect(bar.getByRole('status').textContent).toBe('2 of up to 2 selected')
    const third = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Select PR #1 for the panel',
    })
    expect(third.disabled).toBe(true)
    expect(bar.getByRole('button', { name: 'Ask the panel' })).toBeTruthy()
  })

  it('says while checks and reviews load', () => {
    const pending = { ...pull(1), status: undefined }
    const view = render(createElement(Inbox, { pulls: [pending], statusLoading: true }))

    expect(screen.getByRole('status').textContent).toBe('Loading checks and review status…')

    view.rerender(createElement(Inbox, { pulls: [pull(1)] }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
