import type { PullRequest } from '../shared/types'
import type { PullRevision } from '../shared/updates'
import { fetchPullRevision } from './github'

/** Tabs share one short-lived metadata request for the same PR. */
export function createRevisionChecker(
  fetchRevision: (pull: PullRequest) => Promise<PullRevision> = fetchPullRevision,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { revision: PullRevision; checkedAt: number }>()
  const pending = new Map<string, Promise<PullRevision>>()
  return async (pull: PullRequest): Promise<PullRevision> => {
    const key = `${pull.owner}/${pull.repo}/${pull.number}`
    const previous = cache.get(key)
    if (previous && now() - previous.checkedAt < 15_000) return previous.revision
    const running = pending.get(key)
    if (running) return running
    const request = fetchRevision(pull).then((revision) => {
      cache.delete(key)
      cache.set(key, { revision, checkedAt: now() })
      // Bound long-running desktop sessions without retaining every visited repository.
      if (cache.size > 100) cache.delete(cache.keys().next().value!)
      return revision
    })
    pending.set(key, request)
    try {
      return await request
    } finally {
      pending.delete(key)
    }
  }
}
