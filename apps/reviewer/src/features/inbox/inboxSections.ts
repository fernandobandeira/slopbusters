import type { InboxPull } from '../../../shared/domain/types'
import type { PullStatus } from '../../../shared/domain/pullStatus'

export type InboxSectionId =
  | 'conflicts'
  | 'comments'
  | 'failing-ci'
  | 'reviews'
  | 'pending-checks'
  | 'actions'
  | 'unknown'
  | 'ready'

export interface InboxSection {
  id: InboxSectionId
  label: string
  pulls: InboxPull[]
}

const sectionLabels: { id: InboxSectionId; label: string }[] = [
  { id: 'conflicts', label: 'Merge conflicts' },
  { id: 'comments', label: 'Unresolved comments' },
  { id: 'failing-ci', label: 'Failing CI' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'pending-checks', label: 'Checks pending' },
  { id: 'actions', label: 'Drafts and other actions' },
  { id: 'unknown', label: 'Status unavailable' },
  { id: 'ready', label: 'Ready to merge' },
]

/** One actionable section per PR; GitHub's authoritative readiness is the only ready signal. */
export function inboxSections(pulls: InboxPull[]): InboxSection[] {
  const sections = sectionLabels.map((section) => ({ ...section, pulls: [] as InboxPull[] }))
  const destinations = new Map(sections.map((section) => [section.id, section]))
  for (const pull of pulls) destinations.get(sectionFor(pull))!.pulls.push(pull)
  return sections.filter((section) => section.pulls.length > 0)
}

function sectionFor(pull: InboxPull): InboxSectionId {
  const status = pull.status?.headSha === pull.headSha ? pull.status : undefined
  if (!status) return pull.isDraft ? 'actions' : 'unknown'
  if (status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY') return 'conflicts'
  if ((status.unresolvedReviewThreads ?? 0) > 0) return 'comments'
  // Failing CI comes before reviews: the author can act on it, and reviewers would wait for it.
  if (hasFailingChecks(status)) return 'failing-ci'
  if (needsReview(status)) return 'reviews'
  if (
    ['PENDING', 'EXPECTED'].includes(status.checksState ?? '') ||
    status.checks.some((check) => check.status !== 'completed')
  )
    return 'pending-checks'
  if (pull.isDraft || status.isDraft || status.readiness === 'not-ready') return 'actions'
  return status.readiness === 'ready' ? 'ready' : 'unknown'
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
