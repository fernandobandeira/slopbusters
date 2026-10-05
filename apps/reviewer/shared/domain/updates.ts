import type { PullRequest } from './types'

export interface PullRevision {
  headSha: string
  baseSha: string
  state: PullRequest['state']
}

export function pullHasUpdates(pull: PullRevision, current: PullRevision): boolean {
  return (
    pull.headSha !== current.headSha ||
    pull.baseSha !== current.baseSha ||
    pull.state !== current.state
  )
}
