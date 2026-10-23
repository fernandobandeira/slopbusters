import type { GroundingState } from './grounding'
import type { JudgeAdvice, PanelAdvice, PanelReviewer, UnplacedFinding } from './panel'
import type { OrganizationPreferences } from './preferences'
import type { PullRequest, PullReviewBody, ReviewThread } from './types'

export interface PanelReview {
  /** The seat that wrote it. */
  reviewer: string
  advice?: PanelAdvice
  /** Findings whose location the evidence could not place, kept as the seat wrote them. */
  unplaced?: UnplacedFinding[]
  /** The seat returned its full cap, so it may have had more findings than it reported. */
  capped?: boolean
  /** Which version of its skill or instructions the seat reviewed with; its model is the seat's. */
  skillDigest?: string
  error?: string
}
export interface PanelPending extends PanelSnapshot {
  reviews: PanelReview[]
  /** The grounding debate so far, saved after every valid turn so a retry resumes it. */
  grounding?: GroundingState
}
export interface PanelResult {
  pull: PullRequest
  fingerprint: string
  /** The result as a review: grounded findings to comment on, and what was set aside. */
  advice: JudgeAdvice
  /** What each reviewer said before grounding, for a chat that continues one of them. */
  reviews: PanelReview[]
  /** How grounding accounted for every finding; absent on sessions judged before grounding. */
  grounding?: GroundingState
}
/** What reviewers already said on a PR: its inline threads and its reviews' bodies. */
export interface ReviewHistory {
  threads: ReviewThread[]
  reviews: PullReviewBody[]
}
/** A PR snapshot a round loaded, what the PR is meant to do, and what reviewers said on it. */
export interface PanelSnapshot {
  pull: PullRequest
  fingerprint: string
  context?: string
  history?: ReviewHistory
}
/**
 * What a round loads before any seat starts: every chosen PR and the other open layers of their
 * stacks, so the first layer's seats already see the layers above it.
 */
export interface PanelPreparation {
  snapshots: PanelSnapshot[]
  /** By chosen PR URL: the URLs of the other layers of its stack that loaded. */
  layers: Record<string, string[]>
  /** By chosen PR URL: what about its stack could not be loaded, in words. */
  missing: Record<string, string[]>
}
export interface PanelSession {
  id: string
  repository: string
  urls: string[]
  model: OrganizationPreferences
  /** The other provider's review model. */
  companion?: OrganizationPreferences
  /** The stronger models that ground findings; absent on sessions from before they were fixed. */
  judges?: { primary: OrganizationPreferences; companion?: OrganizationPreferences }
  reviewers: PanelReviewer[]
  status: 'running' | 'partial' | 'complete' | 'failed' | 'cancelled'
  progress: string
  results: PanelResult[]
  pending?: PanelPending
  /** Kept on the server; the API leaves the loaded layers out. */
  preparation?: PanelPreparation
  error?: string
  createdAt: string
}
