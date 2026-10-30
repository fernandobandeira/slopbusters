import type { GitHub } from '../../adapters/github'
import type { GitIdentity } from '../../adapters/gitIdentity'
import { openSplitWorkspace } from '../../adapters/splitWorkspace'
import type { ReviewerStore } from '../../adapters/store'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import type { PullRequest } from '../../../shared/domain/types'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { SplitJobs } from './splitJobs'
import { createSplitPulls } from './splitPulls'
import { loadLinusSplitSkill } from './splitTurns'

/** Linus's splits on the real GitHub, with the app's data directory and Git identity. */
export function createSplitJobs(options: {
  store: ReviewerStore
  turns: StructuredTurns
  sessions: AgentSessions
  github: GitHub
  identity: (signal: AbortSignal) => Promise<GitIdentity>
  staticDirectory: string
  skillDirectory?: string
  dataDirectory: string
  loadPull: (url: string) => Promise<PullRequest>
  remoteUrl?: (repository: string) => string
}): SplitJobs {
  return new SplitJobs({
    store: options.store,
    turns: options.turns,
    sessions: options.sessions,
    skill: () => loadLinusSplitSkill(options.staticDirectory, options.skillDirectory),
    loadPull: options.loadPull,
    identity: options.identity,
    pulls: createSplitPulls(options.github),
    openWorkspace: (pull, signal) =>
      openSplitWorkspace({
        dataDirectory: options.dataDirectory,
        pull,
        github: options.github,
        signal,
        remoteUrl: options.remoteUrl,
      }),
  })
}
