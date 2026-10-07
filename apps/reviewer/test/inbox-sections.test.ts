import { describe, expect, it } from 'vitest'
import type { InboxPull } from '../shared/domain/types'
import type { PullStatus } from '../shared/domain/pullStatus'
import { inboxSections } from '../src/features/inbox/inboxSections'

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

describe('actionable inbox sections', () => {
  it('shows a PR with several blockers once under the highest-priority conflict', () => {
    const blocked = pull(1, {
      readiness: 'not-ready',
      mergeable: 'CONFLICTING',
      reviewDecision: 'REVIEW_REQUIRED',
      unresolvedReviewThreads: 3,
      checksState: 'FAILURE',
    })

    const sections = inboxSections([blocked])

    expect(sections).toEqual([{ id: 'conflicts', label: 'Merge conflicts', pulls: [blocked] }])
  })

  it('puts unresolved comments before failing CI even when reviews are approved', () => {
    const blocked = pull(2, { unresolvedReviewThreads: 1, checksState: 'FAILURE' })

    const sections = inboxSections([blocked])

    expect(sections[0]?.id).toBe('comments')
    expect(sections.flatMap((section) => section.pulls)).toEqual([blocked])
  })

  it('keeps unresolved comments separate from required reviews with one primary section per PR', () => {
    const comments = pull(16, { unresolvedReviewThreads: 2, reviewDecision: 'REVIEW_REQUIRED' })
    const review = pull(17, { unresolvedReviewThreads: 0, reviewDecision: 'REVIEW_REQUIRED' })

    const sections = inboxSections([review, comments])

    expect(sections).toEqual([
      { id: 'comments', label: 'Unresolved comments', pulls: [comments] },
      { id: 'reviews', label: 'Reviews', pulls: [review] },
    ])
    expect(sections.flatMap((section) => section.pulls)).toHaveLength(2)
  })

  it('does not place missing, unknown, or zero unresolved counts in the comments section', () => {
    const ready = [undefined, null, 0].map((unresolvedReviewThreads, index) =>
      pull(18 + index, { unresolvedReviewThreads }),
    )

    const sections = inboxSections(ready)

    expect(sections).toEqual([{ id: 'ready', label: 'Ready to merge', pulls: ready }])
  })

  it('orders conflicts before comments and reviews while keeping ready last', () => {
    const conflict = pull(21, { mergeable: 'CONFLICTING', unresolvedReviewThreads: 1 })
    const comments = pull(22, { unresolvedReviewThreads: 1 })
    const review = pull(23, { reviewDecision: 'CHANGES_REQUESTED' })
    const ready = pull(24)

    const sections = inboxSections([ready, review, comments, conflict])

    expect(sections.map((section) => section.id)).toEqual([
      'conflicts',
      'comments',
      'reviews',
      'ready',
    ])
    expect(sections.flatMap((section) => section.pulls)).toHaveLength(4)
  })

  it.each(['CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const)(
    'puts a failing check before %s so Gandalf can fix it',
    (reviewDecision) => {
      const blocked = pull(3, { reviewDecision, checksState: 'FAILURE' })
      const review = pull(7, { reviewDecision })

      const sections = inboxSections([review, blocked])

      expect(sections).toEqual([
        { id: 'failing-ci', label: 'Failing CI', pulls: [blocked] },
        { id: 'reviews', label: 'Reviews', pulls: [review] },
      ])
    },
  )

  it('groups required approvals without a confirmed review decision as reviews', () => {
    const blocked = pull(4, { readiness: 'not-ready', reviewDecision: null, requiredApprovals: 2 })

    const sections = inboxSections([blocked])

    expect(sections[0]?.id).toBe('reviews')
  })

  it('recognizes an individual failed check when the aggregate is unavailable', () => {
    const blocked = pull(5, {
      checksState: null,
      checks: [{ name: 'test', kind: 'check', status: 'completed', conclusion: 'TIMED_OUT' }],
    })

    const sections = inboxSections([blocked])

    expect(sections[0]?.id).toBe('failing-ci')
  })

  it('puts pending checks before draft and other action sections', () => {
    const blocked = pull(6, { isDraft: true, readiness: 'not-ready', checksState: 'PENDING' })

    const sections = inboxSections([blocked])

    expect(sections[0]?.id).toBe('pending-checks')
  })

  it('keeps drafts and known blocked merge requirements out of ready', () => {
    const draft = { ...pull(7), isDraft: true }
    const behind = pull(8, { readiness: 'not-ready', mergeState: 'BEHIND' })

    const sections = inboxSections([draft, behind])

    expect(sections).toEqual([
      { id: 'actions', label: 'Drafts and other actions', pulls: [draft, behind] },
    ])
  })

  it('does not label missing metadata, unknown summaries, or stale status as ready', () => {
    const pending = { ...pull(9), status: undefined }
    const unknown = pull(10, { detailLevel: 'summary', readiness: 'unknown' })
    const stale = pull(11, { headSha: 'older-head' })

    const sections = inboxSections([pending, unknown, stale])

    expect(sections).toEqual([
      { id: 'unknown', label: 'Status unavailable', pulls: [pending, unknown, stale] },
    ])
  })

  it('keeps ready last, preserves input order within each section, and loses no PRs', () => {
    const readyA = pull(12)
    const readyB = pull(13)
    const failing = pull(14, { readiness: 'not-ready', checksState: 'FAILURE' })
    const unknown = pull(15, { readiness: 'unknown' })

    const sections = inboxSections([readyA, failing, readyB, unknown])

    expect(sections.map((section) => section.id)).toEqual(['failing-ci', 'unknown', 'ready'])
    expect(sections.at(-1)?.pulls).toEqual([readyA, readyB])
    expect(
      sections
        .flatMap((section) => section.pulls)
        .map((item) => item.number)
        .sort(),
    ).toEqual([12, 13, 14, 15])
  })
})
