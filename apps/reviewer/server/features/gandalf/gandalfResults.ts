import type { GandalfSession } from '../../../shared/domain/gandalf'
import type { PullRequest } from '../../../shared/domain/types'

type Result = GandalfSession['results'][number]

export function saveResult(session: GandalfSession, result: Result) {
  session.results = session.results.filter((previous) => previous.url !== result.url)
  session.results.push(result)
}

/** A PR that needed no work keeps an earlier result for the same revision. */
export function unchangedResult(session: GandalfSession, url: string, pull: PullRequest): Result {
  const previous = session.results.find((result) => result.url === url)
  if (previous?.resolvedSha === pull.headSha && previous.baseSha === pull.baseSha) return previous
  return {
    url,
    number: pull.number,
    title: pull.title,
    headSha: pull.headSha,
    baseSha: pull.baseSha,
    resolvedSha: pull.headSha,
    changedPaths: [],
    rounds: 0,
    published: false,
  }
}

/** A recheck after the base moved builds on this session's earlier update; keep its report. */
export function publishedResult(
  session: GandalfSession,
  url: string,
  pull: PullRequest,
  update: { resolvedSha: string; rounds: number },
): Result {
  const previous = session.results.find(
    (result) => result.url === url && result.published && result.resolvedSha === pull.headSha,
  )
  return {
    url,
    number: pull.number,
    title: pull.title,
    headSha: previous?.headSha ?? pull.headSha,
    baseSha: pull.baseSha,
    resolvedSha: update.resolvedSha,
    changedPaths: [
      ...new Set([
        ...(previous?.changedPaths ?? []),
        ...session.turns.filter((turn) => turn.url === url).flatMap((turn) => turn.changedPaths),
      ]),
    ],
    rounds: (previous?.rounds ?? 0) + update.rounds,
    // A CI fix that changes nothing, such as for an infrastructure flake, is not pushed.
    published: update.resolvedSha !== pull.headSha,
  }
}

export function completion(session: GandalfSession) {
  if (session.task === 'conflicts')
    return 'You may pass. All PRs and their stack layers are up to date.'
  return session.results.some((result) => result.published)
    ? 'You may pass. The fixes are pushed and CI is running again.'
    : 'You may pass. No failing check needed a change.'
}
