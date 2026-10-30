import type { OrganizationPreferences } from './preferences'
import type { PullRequest } from './types'

export interface ReviewResult<Advice> {
  pull: PullRequest
  fingerprint: string
  advice: Advice
  reviewers: OrganizationPreferences[]
}
export interface PendingReview<Advice> {
  pull: PullRequest
  fingerprint: string
  /** The linked ticket, as JSON evidence, when the PR has one and Linear is connected. */
  context?: string
  reviews: { model: OrganizationPreferences; advice?: Advice; error?: string }[]
}
export interface ReviewSession<Advice> {
  id: string
  repository: string
  urls: string[]
  primary: OrganizationPreferences
  companion: OrganizationPreferences
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
  progress: string
  results: ReviewResult<Advice>[]
  pending?: PendingReview<Advice>
  error?: string
  createdAt: string
  /** What the author asked the reviewer to weigh, when asking again. */
  guidance?: string
}

/** A running or partial review holds its persona until the user finishes or cancels it. */
export function blocksNewReview(session: Pick<ReviewSession<unknown>, 'status'>): boolean {
  return session.status === 'running' || session.status === 'partial'
}

/** The PRs a review covers, such as "PR #12" or "PR #12 and PR #14". */
export function reviewedPullsLabel(urls: string[]): string {
  const names = urls.map((url) => {
    const number = /\/pull\/(\d+)/.exec(url)?.[1]
    return number ? `PR #${number}` : url
  })
  const last = names.pop()
  if (!last) return 'its PRs'
  return names.length ? `${names.join(', ')} and ${last}` : last
}
