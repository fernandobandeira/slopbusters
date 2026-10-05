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
}
