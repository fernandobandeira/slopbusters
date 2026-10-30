import { openSplitWorkspace } from '../../adapters/splitWorkspace'
import type { BranchDependencies, JobDependencies } from '../jobDependencies'
import { SplitJobs } from './splitJobs'
import { createSplitPulls } from './splitPulls'
import { loadLinusSplitSkill } from './splitTurns'

/** Linus's splits on the real GitHub, with the app's data directory and Git identity. */
export function createSplitJobs(
  options: Pick<JobDependencies, 'store' | 'turns' | 'sessions' | 'staticDirectory' | 'loadPull'> &
    BranchDependencies & { skillDirectory?: string },
): SplitJobs {
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
