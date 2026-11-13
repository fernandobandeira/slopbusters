import {
  builtInReviewerIds,
  builtInReviewers,
  defaultPanelReviewers,
  teammateReviewerId,
  type ReviewerId,
} from '../../../shared/domain/panel'
import { panelBriefMarkdown } from '../../../shared/domain/panelBrief'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import { availabilityLabels, skillAvailability } from '../../../shared/domain/teammates'
import { UserError } from '../../errors'
import type { PanelJobs } from '../panel/panelJobs'
import type { Teammates } from '../teammates/teammates'
import { PANEL_POLL_MS } from './limits'

interface Options {
  jobs: Pick<PanelJobs, 'start' | 'latest' | 'retry' | 'continue' | 'cancel'>
  teammates: Pick<Teammates, 'list'>
  /** How often a wait looks at the panel again. */
  pollMs?: number
}

/**
 * What a coding agent can ask of the panel, answered in words it can act on. A PR's URL names its
 * panel in every call, because one PR has one panel working at a time.
 */
export class PanelTools {
  constructor(private readonly options: Options) {}

  /** Who can sit on a panel, with the ids `start` takes. */
  async reviewers(): Promise<string> {
    const teammates = await this.options.teammates.list()
    const lines = [
      ...builtInReviewerIds.map(
        (id) => `- \`${id}\`: ${builtInReviewers[id].name}. ${builtInReviewers[id].description}`,
      ),
      ...teammates.map(
        (teammate) =>
          `- \`${teammateReviewerId(teammate.id)}\`: ${[teammate.name, teammate.title].filter(Boolean).join(', ')}. Predicts this teammate's comments from the ${teammate.skill} skill (${availabilityLabels[skillAvailability(teammate.locations)]}).`,
      ),
    ]
    const defaults = defaultPanelReviewers.map((id) => builtInReviewers[id].name).join(' and ')
    return `Reviewers who can sit on a panel:\n\n${lines.join('\n')}\n\nWithout a choice, a panel is ${defaults}.`
  }

  /** Start a panel on a PR, or return the one already working on it with the same reviewers. */
  async start(
    pullRequest: string,
    reviewers: readonly ReviewerId[] = defaultPanelReviewers,
  ): Promise<string> {
    const { repository, url } = target(pullRequest)
    return report(await this.options.jobs.start(repository, [url], [...reviewers]), url)
  }

  /** The PR's newest panel: its review, or how far it is after waiting up to `waitSeconds`. */
  async read(pullRequest: string, waitSeconds: number, signal: AbortSignal): Promise<string> {
    const { repository, url, name } = target(pullRequest)
    const deadline = Date.now() + waitSeconds * 1000
    for (;;) {
      const session = this.options.jobs.latest(repository, url)
      if (!session) return `No panel has reviewed ${name}. Call start_panel_review to ask for one.`
      const remaining = deadline - Date.now()
      if (!reviewing(session, url) || signal.aborted || remaining <= 0) return report(session, url)
      await pause(Math.min(this.options.pollMs ?? PANEL_POLL_MS, remaining), signal)
    }
  }

  /** Run a stopped panel again, or ground the reviews that finished without the failed ones. */
  retry(pullRequest: string, skipFailedReviewers: boolean): string {
    const { url, name, session } = this.latest(pullRequest)
    if (session.results.some((result) => result.pull.url === url))
      throw new UserError(
        `The panel already reviewed ${name}. Call start_panel_review to review it again.`,
      )
    const { jobs } = this.options
    return report(skipFailedReviewers ? jobs.continue(session.id) : jobs.retry(session.id), url)
  }

  cancel(pullRequest: string): string {
    const { url, name, session } = this.latest(pullRequest)
    if (!blocksNewReview(session)) throw new UserError(`No panel is working on ${name}.`)
    return report(this.options.jobs.cancel(session.id), url)
  }

  private latest(pullRequest: string) {
    const { repository, url, name } = target(pullRequest)
    const session = this.options.jobs.latest(repository, url)
    if (!session) throw new UserError(`No panel has reviewed ${name}.`, 404)
    return { url, name, session }
  }
}

/** The repository and canonical URL of a PR, whichever of its pages the agent passed. */
export function target(pullRequest: string) {
  const { owner, repo, number } = parsePullUrl(pullRequest)
  return {
    repository: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}/pull/${String(number)}`,
    name: `PR #${String(number)}`,
  }
}

/** Still working towards this PR's review, rather than done with it or stopped. */
function reviewing(session: PanelSession, url: string): boolean {
  return session.status === 'running' && !session.results.some((result) => result.pull.url === url)
}

/** A panel as an agent needs it: the PR's review once there is one, else its state and next step. */
function report(session: PanelSession, url: string): string {
  const result = session.results.find((entry) => entry.pull.url === url)
  if (result) return review(session, result)
  const name = `PR #${String(parsePullUrl(url).number)}`
  const panel = session.reviewers.map((reviewer) => reviewer.name).join(', ')
  if (session.status === 'running')
    return `${session.queued ? 'The panel is waiting its turn to review' : 'The panel is reviewing'} ${name} (${panel}). ${session.progress}\n\nCall get_panel_review with this PR to wait for the review. A panel takes several minutes.`
  if (session.status === 'partial')
    return `The panel on ${name} is waiting because some reviewers could not finish:\n${session.error ?? session.progress}\n\nCall retry_panel_review to run them again, or with skip_failed_reviewers to ground the reviews that finished.`
  return `The panel review of ${name} did not finish. ${[session.progress, session.error].filter(Boolean).join('\n')}\n\nCall retry_panel_review to run it again; reviews that finished are kept.`
}

/** The grounded review as a brief, saying first what the author has and has not decided. */
function review(session: PanelSession, result: PanelResult): string {
  const notes: string[] = []
  if (result.grounding?.resolved?.length && !result.gate)
    notes.push(
      'The author has not chosen fixes in Slopbusters yet. "The fixes the author chose" below is the default selection, in order: removals of code nothing needs, then confirmed defects and repository rules, then product and wording, then tests. Edge cases that need several things to go wrong are left out unless several reviewers raised them and the fix is small. Problems that were already there are left for a follow-up. A question for the author takes the panel’s recommendation unless it goes against the linked ticket. "Needs your decision" lists those conflicts and what the two models could not agree on; do not act on them until the author answers.',
    )
  if (result.handoff?.state === 'sent')
    notes.push(
      'The author already sent fixes from this review to a fix thread; ask before fixing the same findings here.',
    )
  return [...notes, panelBriefMarkdown(result, session.reviewers)].join('\n\n')
}

/** Resolves after `milliseconds`, or as soon as the caller stops waiting. */
export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', done)
  })
}
