import type { InboxPull } from '../../../shared/domain/types'
import type { PullStatus } from '../../../shared/domain/pullStatus'

/** What a PR needs next, one per PR, from its checks, reviews and merge state. */
export type PullStatusGroup =
  | 'conflicts'
  | 'comments'
  | 'failing-ci'
  | 'reviews'
  | 'pending-checks'
  | 'actions'
  | 'unknown'
  | 'ready'

/** The one thing a PR needs first; GitHub's authoritative readiness is the only ready signal. */
export function pullStatusGroup(pull: InboxPull): PullStatusGroup {
  const status = pull.status?.headSha === pull.headSha ? pull.status : undefined
  if (!status) return pull.isDraft ? 'actions' : 'unknown'
  if (hasConflicts(status)) return 'conflicts'
  if ((status.unresolvedReviewThreads ?? 0) > 0) return 'comments'
  // Failing CI comes before reviews: the author can act on it, and reviewers would wait for it.
  if (hasFailingChecks(status)) return 'failing-ci'
  if (needsReview(status)) return 'reviews'
  if (hasPendingChecks(status)) return 'pending-checks'
  if (pull.isDraft || status.isDraft || status.readiness === 'not-ready') return 'actions'
  return status.readiness === 'ready' ? 'ready' : 'unknown'
}

function hasPendingChecks(status: PullStatus): boolean {
  return (
    ['PENDING', 'EXPECTED'].includes(status.checksState ?? '') ||
    status.checks.some((check) => check.status !== 'completed')
  )
}

function hasConflicts(status: PullStatus): boolean {
  return status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY'
}

function needsReview(status: PullStatus): boolean {
  if (['CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(status.reviewDecision ?? '')) return true
  return (
    status.reviewDecision === null &&
    ((status.requiredApprovals ?? 0) > 0 ||
      Boolean(status.requiresCodeOwnerReviews) ||
      status.reviewers.some((reviewer) => reviewer.state === 'changes-requested'))
  )
}

function hasFailingChecks(status: PullStatus): boolean {
  if (['FAILURE', 'ERROR'].includes(status.checksState ?? '')) return true
  return status.checks.some((check) =>
    ['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(
      check.conclusion?.toUpperCase().replaceAll('-', '_') ?? '',
    ),
  )
}
