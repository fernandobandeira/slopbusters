import type { PullRequest } from '../../shared/domain/types'
import type { GitHub } from '../adapters/github'
import type { GitIdentity } from '../adapters/gitIdentity'
import type { ReviewCheckout } from '../adapters/reviewWorkspaces'
import type { ReviewerStore } from '../adapters/store'
import type { StructuredTurns } from '../adapters/t3Engine/engineTurns'
import type { AgentSessions } from './agent-sessions/agentSessions'

/**
 * What the persona jobs share, built once by `createServices`. Each job picks the fields it uses
 * and adds its own, such as where its skill is.
 */
export interface JobDependencies {
  /** Preferences, from which every job reads its models, and each persona's saved sessions. */
  store: ReviewerStore
  /** Where agent turns run. */
  turns: StructuredTurns
  /** The activity log every run reports to. */
  sessions?: AgentSessions
  /** Where the skills bundled with the app are. */
  staticDirectory: string
  loadPull: (url: string) => Promise<PullRequest>
  /** Lease a checkout of the PR head for agents to read. */
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
  /** Evidence about what the PR is meant to do, such as its linked ticket. */
  context?: (pull: PullRequest, signal: AbortSignal) => Promise<string | undefined>
}

/** What jobs that push branches to GitHub add: the app's data directory and Git identity. */
export interface BranchDependencies {
  github: GitHub
  identity: (signal: AbortSignal) => Promise<GitIdentity>
  dataDirectory: string
  /** Where a repository's Git remote is, for tests that point workspaces at a local one. */
  remoteUrl?: (repository: string) => string
}
