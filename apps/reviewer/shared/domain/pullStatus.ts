export interface PullCheck {
  name: string
  kind: 'check' | 'status'
  status: 'queued' | 'in-progress' | 'completed'
  conclusion: string | null
  url?: string
  required?: boolean
}
export interface PullReviewer {
  login: string
  type: 'user' | 'team'
  avatarUrl?: string
  url?: string
  state: 'requested' | 'approved' | 'changes-requested' | 'commented' | 'dismissed' | 'pending'
}
export interface ReviewDiscussion {
  id: string
  path: string
  line: number | null
  originalLine: number | null
  outdated: boolean
  url?: string
  author?: string
  body: string
}
export interface PullStatus {
  detailLevel?: 'summary' | 'full'
  unresolvedReviewThreads?: number | null
  unresolvedThreads?: ReviewDiscussion[]
  headSha: string
  baseSha: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  readiness: 'ready' | 'not-ready' | 'checking' | 'unknown' | 'merged' | 'closed'
  reasons: string[]
  mergeState: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  requiredApprovals: number | null
  requiresCodeOwnerReviews: boolean | null
  requirementsKnown: boolean
  checksState: string | null
  checks: PullCheck[]
  reviewers: PullReviewer[]
  warnings: string[]
}

/** GitHub's merge state is authoritative; passing CI does not establish merge readiness. */
export function classifyReadiness(
  status: Omit<PullStatus, 'readiness' | 'reasons'>,
): Pick<PullStatus, 'readiness' | 'reasons'> {
  if (status.state === 'merged')
    return { readiness: 'merged', reasons: ['This pull request was merged.'] }
  if (status.state === 'closed')
    return { readiness: 'closed', reasons: ['This pull request is closed.'] }
  const reasons: string[] = []
  if (status.isDraft) reasons.push('This pull request is a draft.')
  if (status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY')
    reasons.push('Merge conflicts must be resolved.')
  if (status.reviewDecision === 'CHANGES_REQUESTED') reasons.push('A reviewer requested changes.')
  if (status.reviewDecision === 'REVIEW_REQUIRED')
    reasons.push('Required reviews are still outstanding.')
  if (
    status.reviewDecision == null &&
    ((status.requiredApprovals ?? 0) > 0 || status.requiresCodeOwnerReviews)
  )
    reasons.push('Required reviews have not been confirmed by GitHub.')
  if (status.mergeState === 'BEHIND') reasons.push('The branch must be updated with its base.')
  if (status.mergeState === 'BLOCKED') reasons.push('GitHub reports unmet merge requirements.')
  if (status.mergeState === 'UNSTABLE' || ['FAILURE', 'ERROR'].includes(status.checksState ?? ''))
    reasons.push('Checks have not all passed.')
  if (reasons.length) return { readiness: 'not-ready', reasons }
  if (
    status.mergeState === 'UNKNOWN' ||
    status.mergeable === 'UNKNOWN' ||
    ['PENDING', 'EXPECTED'].includes(status.checksState ?? '')
  )
    return {
      readiness: 'checking',
      reasons: ['GitHub is still calculating mergeability or waiting for checks.'],
    }
  if (
    status.mergeState === 'CLEAN' &&
    status.mergeable === 'MERGEABLE' &&
    status.warnings.length === 0
  )
    return {
      readiness: 'ready',
      reasons: ['GitHub reports that this pull request meets its merge requirements.'],
    }
  return {
    readiness: 'unknown',
    reasons: ['GitHub has not confirmed that all merge requirements are met.'],
  }
}
