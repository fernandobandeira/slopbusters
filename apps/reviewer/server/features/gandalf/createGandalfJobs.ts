import { loadCiFailures } from '../../adapters/ciFailures'
import { openConflictWorkspace } from '../../adapters/conflictWorkspace'
import type { GitHub } from '../../adapters/github'
import type { GitIdentity } from '../../adapters/gitIdentity'
import type { ReviewerStore } from '../../adapters/store'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import type { PullRequest } from '../../../shared/domain/types'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { GandalfJobs } from './gandalfJobs'
import { createGandalfPlanner } from './gandalfPlan'

/** Gandalf on the real GitHub, with the app's data directory and Git identity. */
export function createGandalfJobs(options: {
  store: ReviewerStore
  turns: StructuredTurns
  sessions: AgentSessions
  github: GitHub
  identity: (signal: AbortSignal) => Promise<GitIdentity>
  dataDirectory: string
  loadPull: (url: string) => Promise<PullRequest>
  getStack: Parameters<typeof createGandalfPlanner>[0]
  remoteUrl?: (repository: string) => string
}): GandalfJobs {
  const { github } = options
  return new GandalfJobs({
    store: options.store,
    turns: options.turns,
    sessions: options.sessions,
    loadPull: options.loadPull,
    plan: createGandalfPlanner(options.getStack),
    loadFailures: (pull, signal) => loadCiFailures(github, pull, signal),
    openWorkspace: (pull, signal, task) =>
      openConflictWorkspace({
        dataDirectory: options.dataDirectory,
        pull,
        github,
        signal,
        task,
        identity: options.identity,
        remoteUrl: options.remoteUrl,
      }),
  })
}
