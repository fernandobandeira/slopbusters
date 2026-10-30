import { loadCiFailures } from '../../adapters/ciFailures'
import { openConflictWorkspace } from '../../adapters/conflictWorkspace'
import type { BranchDependencies, JobDependencies } from '../jobDependencies'
import { GandalfJobs } from './gandalfJobs'
import { createGandalfPlanner } from './gandalfPlan'

/** Gandalf on the real GitHub, with the app's data directory and Git identity. */
export function createGandalfJobs(
  options: Pick<JobDependencies, 'store' | 'turns' | 'sessions' | 'loadPull'> &
    BranchDependencies & { getStack: Parameters<typeof createGandalfPlanner>[0] },
): GandalfJobs {
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
