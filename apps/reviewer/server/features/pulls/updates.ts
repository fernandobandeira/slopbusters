import type { PullRequest } from '../../../shared/domain/types'
import type { PullRevision } from '../../../shared/domain/updates'
import { fetchPullRevision } from './github'
import { createCache } from '../../cache'
import { INBOX_TTL_MS } from '../../limits'

/** Tabs share one short-lived metadata request for the same PR. */
export function createRevisionChecker(
  fetchRevision: (pull: PullRequest) => Promise<PullRevision> = fetchPullRevision,
  now: () => number = Date.now,
) {
  const cache = createCache<PullRevision>({ max: 100, ttlMs: INBOX_TTL_MS, now })
  return (pull: PullRequest) =>
    cache.load(`${pull.owner}/${pull.repo}/${pull.number}`, () => fetchRevision(pull))
}
