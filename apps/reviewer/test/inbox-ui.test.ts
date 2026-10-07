// @vitest-environment happy-dom
import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxPull } from '../shared/domain/types'
import type { PullStatus } from '../shared/domain/pullStatus'
import { InboxPage } from '../src/features/inbox/InboxPage'

afterEach(cleanup)

function pull(number: number, changes: Partial<PullStatus> = {}): InboxPull {
  return {
    number,
    url: `https://github.com/example/project/pull/${number}`,
    title: `Change ${number}`,
    author: 'alice',
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

function MyPulls({
  pulls,
  statusLoading = false,
}: {
  pulls: InboxPull[]
  statusLoading?: boolean
}) {
  const [selectedLinusUrls, onSelectionChange] = useState<string[]>([])
  return createElement(
    MemoryRouter,
    null,
    createElement(InboxPage, {
      repository: 'example/project',
      filter: 'mine',
      inbox: { viewer: 'alice', pulls },
      inboxLoading: false,
      statusLoading,
      selectingForLinus: true,
      selectedLinusUrls,
      onSelectionChange,
      onFilter: vi.fn(),
      renderPullActions: () => null,
    }),
  )
}

describe('My PRs groups', () => {
  it('shows conflicts first, then unresolved comments, with each authored PR appearing once', () => {
    const ready = pull(1)
    const comments = pull(2, { unresolvedReviewThreads: 2 })
    const conflict = pull(3, { mergeable: 'CONFLICTING', unresolvedReviewThreads: 1 })
    const other = { ...pull(4), author: 'bob' }

    render(createElement(MyPulls, { pulls: [ready, other, comments, conflict] }))

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Merge conflicts1', 'Unresolved comments1', 'Ready to merge1'])
    for (const [label, pr] of [
      ['Merge conflicts', conflict],
      ['Unresolved comments', comments],
      ['Ready to merge', ready],
    ] as const) {
      expect(within(screen.getByRole('region', { name: label })).getByText(pr.title)).toBeTruthy()
      expect(screen.getAllByText(pr.title)).toHaveLength(1)
    }
    expect(screen.queryByText(other.title)).toBeNull()
  })

  it('keeps Linus selections across groups when status moves a selected PR', () => {
    const conflict = pull(1, { mergeable: 'CONFLICTING' })
    const comments = pull(2, { unresolvedReviewThreads: 1 })
    const view = render(createElement(MyPulls, { pulls: [conflict, comments] }))
    const checkbox = (number: number) =>
      screen.getByRole<HTMLInputElement>('checkbox', { name: `Select PR #${number} for Linus` })

    fireEvent.click(checkbox(1))
    fireEvent.click(checkbox(2))
    expect(checkbox(1).checked).toBe(true)
    expect(checkbox(2).checked).toBe(true)

    view.rerender(createElement(MyPulls, { pulls: [pull(1), comments] }))
    expect(
      within(screen.getByRole('region', { name: 'Ready to merge' })).getByText(conflict.title),
    ).toBeTruthy()
    expect(checkbox(1).checked).toBe(true)
    expect(checkbox(2).checked).toBe(true)
    fireEvent.click(checkbox(1))
    expect(checkbox(1).checked).toBe(false)
    expect(checkbox(2).checked).toBe(true)
  })

  it('shows pending metadata and regroups PRs after status arrives', () => {
    const pending = { ...pull(1), status: undefined }
    const view = render(createElement(MyPulls, { pulls: [pending], statusLoading: true }))

    expect(screen.getByRole('status').textContent).toBe('Loading checks and review status…')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Checking status1')

    view.rerender(createElement(MyPulls, { pulls: [pull(1, { unresolvedReviewThreads: 1 })] }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('region', { name: 'Unresolved comments' })).toBeTruthy()
  })
})
