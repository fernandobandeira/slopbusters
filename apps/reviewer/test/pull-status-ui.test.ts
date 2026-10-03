import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PullStatus } from '../shared/pullStatus'
import { PullReadinessBadge, PullStatusPanel } from '../src/PullStatusPanel'
import { PullStatusIcons } from '../src/PullStatusIcons'

function status(overrides: Partial<PullStatus> = {}): PullStatus {
  return {
    headSha: 'head',
    baseSha: 'base',
    state: 'open',
    isDraft: false,
    readiness: 'not-ready',
    reasons: ['Required reviews are still outstanding.'],
    mergeState: 'BLOCKED',
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    requiredApprovals: 2,
    requiresCodeOwnerReviews: true,
    requirementsKnown: true,
    checksState: 'SUCCESS',
    checks: [
      {
        name: 'CI / tests',
        kind: 'check',
        status: 'completed',
        conclusion: 'SUCCESS',
        required: true,
        url: 'https://github.com/org/repo/actions/runs/1',
      },
    ],
    reviewers: [
      { login: 'alice', type: 'user', state: 'requested', url: 'https://github.com/alice' },
      { login: 'org/security', type: 'team', state: 'changes-requested' },
    ],
    warnings: [],
    ...overrides,
  }
}

describe('pull request readiness display', () => {
  it('distinguishes optional review requests and absent requirements from unavailable review policy', () => {
    const optional = status({
      reviewDecision: null,
      requirementsKnown: true,
      requiredApprovals: 0,
      requiresCodeOwnerReviews: false,
      reviewers: [],
      unresolvedReviewThreads: 0,
    })
    expect(
      renderToStaticMarkup(
        createElement(PullStatusIcons, { status: optional, onSelect: () => undefined }),
      ),
    ).toContain('aria-label="No required reviews"')
    expect(
      renderToStaticMarkup(
        createElement(PullStatusIcons, {
          status: {
            ...optional,
            reviewers: [{ login: 'alice', type: 'user', state: 'requested' }],
          },
          onSelect: () => undefined,
        }),
      ),
    ).toContain('aria-label="Review requested"')
  })
  it('uses compact actionable icons instead of text badges for independent blockers', () => {
    const markup = renderToStaticMarkup(
      createElement(PullStatusIcons, {
        status: status({
          isDraft: true,
          mergeable: 'CONFLICTING',
          checksState: 'FAILURE',
          unresolvedReviewThreads: 3,
        }),
        onSelect: () => undefined,
      }),
    )
    for (const label of [
      'Merge conflicts',
      'CI checks failed',
      'Required reviews missing',
      '3 unresolved review threads',
    ])
      expect(markup).toContain(`aria-label="${label}"`)
    const positions = [
      '3 unresolved review threads',
      'Merge conflicts',
      'Required reviews missing',
      'CI checks failed',
    ].map((label) => markup.indexOf(`aria-label="${label}"`))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(markup).toContain('pull-status-icon-count">3</span>')
    expect(markup).not.toContain('>Draft<')
    expect(markup).not.toContain('>Not ready<')
    expect(markup).not.toContain('Required reviews are still outstanding.')
  })

  it('uses a single review position for authoritative changes requested before checks', () => {
    const markup = renderToStaticMarkup(
      createElement(PullStatusIcons, {
        status: status({ reviewDecision: 'CHANGES_REQUESTED' }),
        onSelect: () => undefined,
      }),
    )
    expect(markup).toContain('aria-label="Changes requested"')
    expect(markup).not.toContain('aria-label="Review approved"')
    expect(markup).not.toContain('aria-label="Required reviews missing"')
    expect(markup.indexOf('aria-label="Changes requested"')).toBeLessThan(
      markup.indexOf('aria-label="CI checks passed"'),
    )
  })

  it('shows passing CI separately from missing review and does not report unknown comments as zero', () => {
    const markup = renderToStaticMarkup(
      createElement(PullStatusIcons, {
        status: status({ unresolvedReviewThreads: null }),
        onSelect: () => undefined,
      }),
    )
    expect(markup).toContain('aria-label="CI checks passed"')
    expect(markup).toContain('aria-label="Required reviews missing"')
    expect(markup).not.toContain('Unresolved review comments not loaded')
    expect(markup).not.toContain('lucide-message-circle')
    expect(markup).not.toContain('pull-status-icon-count')
  })

  it('omits the comments icon for zero, null, and missing unresolved counts', () => {
    for (const count of [0, null, undefined]) {
      const markup = renderToStaticMarkup(
        createElement(PullStatusIcons, {
          status: status({ unresolvedReviewThreads: count }),
          onSelect: () => undefined,
        }),
      )
      expect(markup).not.toContain('lucide-message-circle')
      expect(markup).not.toContain('pull-status-icon-count')
    }
  })

  it('limits selected category details to checks or reviewers who requested changes', () => {
    const checks = renderToStaticMarkup(
      createElement(PullStatusPanel, { status: status(), compact: true, section: 'checks' }),
    )
    expect(checks).toContain('CI / tests')
    expect(checks).not.toContain('@alice')
    expect(checks).not.toContain('Required reviews are still outstanding.')
    expect(checks).not.toContain('Not ready')
    const changes = renderToStaticMarkup(
      createElement(PullStatusPanel, { status: status(), compact: true, section: 'changes' }),
    )
    expect(changes).toContain('@org/security')
    expect(changes).not.toContain('@alice')
    expect(changes).not.toContain('CI / tests')
    expect(changes).not.toContain('Requires 2 approvals.')
  })

  it('shows unresolved review thread locations and excerpts only in comments details', () => {
    const markup = renderToStaticMarkup(
      createElement(PullStatusPanel, {
        section: 'comments',
        compact: true,
        pullUrl: 'https://github.com/org/repo/pull/1',
        status: status({
          unresolvedReviewThreads: 1,
          unresolvedThreads: [
            {
              id: 'thread',
              path: 'src/payment.ts',
              line: 42,
              originalLine: 42,
              outdated: false,
              author: 'alice',
              body: 'Please check this edge case.',
              url: 'https://github.com/org/repo/pull/1#discussion_r1',
            },
          ],
        }),
      }),
    )
    expect(markup).toContain('src/payment.ts:42')
    expect(markup).toContain('Please check this edge case.')
    expect(markup).toContain('discussion_r1')
    expect(markup).not.toContain('CI / tests')
    expect(markup).not.toContain('Requires 2 approvals.')
  })
  it('lets inboxes show draft readiness without adding a Draft text badge', () => {
    const markup = renderToStaticMarkup(
      createElement(PullReadinessBadge, {
        status: status({ isDraft: true, reasons: ['This pull request is a draft.'] }),
        showDraft: false,
      }),
    )
    expect(markup).toContain('Not ready')
    expect(markup).toContain('This pull request is a draft.')
    expect(markup).not.toContain('<span>Draft</span>')
    expect(markup).not.toContain('Ready to merge')
  })
  it('shows passing checks alongside outstanding required review and each reviewer identity', () => {
    const markup = renderToStaticMarkup(createElement(PullStatusPanel, { status: status() }))
    expect(markup).toContain('Not ready')
    expect(markup).toContain('1 passing')
    expect(markup).toContain('Required review missing')
    expect(markup).toContain('Requires 2 approvals.')
    expect(markup).toContain('Code owner review required.')
    expect(markup).toContain('@alice')
    expect(markup).toContain('Review requested')
    expect(markup).toContain('@org/security')
    expect(markup).toContain('Changes requested')
    expect(markup).toContain('https://github.com/org/repo/actions/runs/1')
    expect(markup).not.toContain('Ready to merge')
  })

  it('keeps unknown requirements explicit even when available checks passed', () => {
    const markup = renderToStaticMarkup(
      createElement(PullStatusPanel, {
        status: status({
          readiness: 'unknown',
          requiredApprovals: null,
          requiresCodeOwnerReviews: null,
          requirementsKnown: false,
          reviewDecision: null,
          reasons: ['GitHub has not confirmed all merge requirements.'],
        }),
      }),
    )
    expect(markup).toContain('Readiness unknown')
    expect(markup).toContain('Review requirements unavailable.')
    expect(markup).toContain('1 passing')
    expect(markup).not.toContain('Ready to merge')
  })

  it('shows merged state ahead of a retained draft flag and exposes an accessible details button', () => {
    const markup = renderToStaticMarkup(
      createElement(PullReadinessBadge, {
        status: status({
          state: 'merged',
          isDraft: true,
          readiness: 'merged',
          reasons: ['This pull request was merged.'],
        }),
        onClick: () => undefined,
      }),
    )
    expect(markup).toContain('aria-label="View pull request status: Merged"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).not.toContain('Draft')
  })
})
