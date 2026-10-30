import { describe, expect, it } from 'vitest'
import type { InboxPull } from '../../../../shared/domain/types'
import type { PullStatus } from '../../../../shared/domain/pullStatus'
import { pullStatusGroup } from '../../../../src/features/inbox/inboxStatus'
import {
  byOpenedDate,
  chipCount,
  filterByChips,
  readInboxChips,
  toggleChip,
} from '../../../../src/features/inbox/inboxChips'

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

describe('what a PR needs first', () => {
  it('puts a PR with several blockers under its conflict', () => {
    const blocked = pull(1, {
      readiness: 'not-ready',
      mergeable: 'CONFLICTING',
      reviewDecision: 'REVIEW_REQUIRED',
      unresolvedReviewThreads: 3,
      checksState: 'FAILURE',
    })

    expect(pullStatusGroup(blocked)).toBe('conflicts')
  })

  it('puts unresolved comments before failing CI, and failing CI before reviews', () => {
    expect(pullStatusGroup(pull(2, { unresolvedReviewThreads: 1, checksState: 'FAILURE' }))).toBe(
      'comments',
    )
    expect(
      pullStatusGroup(pull(3, { reviewDecision: 'CHANGES_REQUESTED', checksState: 'FAILURE' })),
    ).toBe('failing-ci')
    expect(pullStatusGroup(pull(4, { reviewDecision: 'REVIEW_REQUIRED' }))).toBe('reviews')
  })

  it('counts required approvals without a review decision as needing review', () => {
    const blocked = pull(5, { readiness: 'not-ready', reviewDecision: null, requiredApprovals: 2 })

    expect(pullStatusGroup(blocked)).toBe('reviews')
  })

  it('recognizes an individual failed check when the aggregate is unavailable', () => {
    const blocked = pull(6, {
      checksState: null,
      checks: [{ name: 'test', kind: 'check', status: 'completed', conclusion: 'TIMED_OUT' }],
    })

    expect(pullStatusGroup(blocked)).toBe('failing-ci')
  })

  it('keeps drafts, pending checks, and blocked merges out of ready', () => {
    expect(pullStatusGroup(pull(7, { isDraft: true, checksState: 'PENDING' }))).toBe(
      'pending-checks',
    )
    expect(pullStatusGroup({ ...pull(8), isDraft: true })).toBe('actions')
    expect(pullStatusGroup(pull(9, { readiness: 'not-ready', mergeState: 'BEHIND' }))).toBe(
      'actions',
    )
  })

  it('does not call missing, unknown, or stale status ready', () => {
    const missing = { ...pull(10), status: undefined }
    const unknown = pull(11, { detailLevel: 'summary', readiness: 'unknown' })
    const stale = pull(12, { headSha: 'older-head' })

    expect([missing, unknown, stale].map(pullStatusGroup)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ])
  })
})

describe('inbox chips', () => {
  const none = { panelReviewed: () => false }

  it('narrows by every trait chip and widens across status chips', () => {
    const draftConflict = { ...pull(1, { mergeable: 'CONFLICTING' }), isDraft: true }
    const draftFailing = { ...pull(2, { checksState: 'FAILURE' }), isDraft: true }
    const draftReady = { ...pull(3), isDraft: true }
    const conflict = pull(4, { mergeable: 'CONFLICTING' })
    const pulls = [draftConflict, draftFailing, draftReady, conflict]

    const shown = filterByChips(pulls, ['draft', 'conflicts', 'failing-ci'], none)

    expect(shown).toEqual([draftConflict, draftFailing])
  })

  it('shows PRs without a panel review of their current head', () => {
    const reviewed = pull(1)
    const outdated = pull(2)
    const context = { panelReviewed: (item: InboxPull) => item === reviewed }

    expect(filterByChips([reviewed, outdated], ['no-panel'], context)).toEqual([outdated])
    expect(chipCount([reviewed, outdated], 'no-panel', context)).toBe(1)
  })

  it('shows everything without chips', () => {
    const pulls = [pull(1), pull(2, { mergeable: 'CONFLICTING' })]

    expect(filterByChips(pulls, [], none)).toEqual(pulls)
  })

  it('orders PRs newest opened first, whatever changed since', () => {
    const older = { ...pull(1), updatedAt: '2026-10-30T00:00:00Z' }
    const newer = pull(2)

    expect(byOpenedDate([older, newer])).toEqual([newer, older])
  })

  it('reads known chips from the URL in chip order and toggles them', () => {
    expect(readInboxChips('?inbox=mine&only=failing-ci,nonsense,draft')).toEqual([
      'draft',
      'failing-ci',
    ])
    expect(toggleChip(['failing-ci'], 'draft')).toEqual(['draft', 'failing-ci'])
    expect(toggleChip(['draft', 'failing-ci'], 'draft')).toEqual(['failing-ci'])
  })
})
