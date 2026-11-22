import {
  builtInReviewerIds,
  builtInReviewers,
  defaultPanelReviewers,
  teammateReviewerId,
  type PanelSeatRequest,
} from '../../../shared/domain/panel'
import { chosenFixes, panelBriefMarkdown } from '../../../shared/domain/panelBrief'
import { gateItems } from '../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import { installedFor } from '../../../shared/domain/teammates'
import { Provider } from '../../../shared/domain/types'
import { logError, UserError } from '../../errors'
import type { PanelJobs } from '../panel/panelJobs'
import type { Teammates } from '../teammates/teammates'
import { PANEL_POLL_MS } from './limits'

interface Options {
  jobs: Pick<PanelJobs, 'start' | 'latest' | 'retry' | 'continue' | 'cancel'>
  teammates: Pick<Teammates, 'list'>
  /** The PR's current head, to tell whether the branch moved since the review. */
  revision?: (url: string) => Promise<{ headSha: string }>
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
    const providers = [Provider.codex, Provider.claude]
    const lines = [
      ...builtInReviewerIds.map(
        (id) =>
          `- \`${id}\`: ${builtInReviewers[id].name} (${providers.join(', ')}). ${builtInReviewers[id].description}`,
      ),
      ...teammates.map((teammate) => {
        const available = providers.filter((provider) => installedFor(teammate.locations, provider))
        const name = [teammate.name, teammate.title].filter(Boolean).join(', ')
        return `- \`${teammateReviewerId(teammate.id)}\`: ${name} (${available.join(', ') || 'no providers installed'}). Predicts this teammate's comments from the ${teammate.skill} skill.`
      }),
    ]
    const defaults = defaultPanelReviewers.map((id) => builtInReviewers[id].name).join(' and ')
    return `Reviewers who can sit on a panel:\n\n${lines.join('\n')}\n\nA bare id runs a built-in reviewer on the primary provider only and a teammate on every provider where its skill is installed.\n\nWithout a choice, a panel is ${defaults}.`
  }

  /** Start a panel on a PR, or return the one already working on it with the same reviewers. */
  async start(
    pullRequest: string,
    reviewers: readonly PanelSeatRequest[] = defaultPanelReviewers,
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
      if (!reviewing(session, url) || signal.aborted || remaining <= 0) {
        const result = session.results.find((entry) => entry.pull.url === url)
        const moved = result ? await this.movedNotice(result) : undefined
        return [moved, report(session, url)].filter(Boolean).join('\n\n')
      }
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

  /**
   * When the branch moved past the reviewed head, whether the fixes the review chose reached it is
   * unknown, and a later review round would hold the author to them. Say so first.
   */
  private async movedNotice(result: PanelResult): Promise<string | undefined> {
    const { revision } = this.options
    if (!revision || !result.grounding?.resolved?.length) return undefined
    const reviewed = result.pull.headSha
    const head = await Promise.resolve()
      .then(async () => (await revision(result.pull.url)).headSha)
      .catch((error: unknown) => {
        logError('Could not check whether the PR moved.', error)
        return undefined
      })
    if (head === undefined)
      return 'Could not check whether the branch moved since the panel reviewed it; compare its head with the reviewed head below.'
    if (head === reviewed) return undefined
    const fixes = chosenFixes(gateItems(result.grounding.resolved, result.gate, result.pull.number))
    const where = `The branch moved since the panel reviewed it: it was at \`${reviewed.slice(0, 9)}\` and is at \`${head.slice(0, 9)}\` now.`
    if (!fixes.length) return `${where} Findings below may no longer hold.`
    const one = fixes.length === 1
    const which = `the ${one ? 'fix' : `${String(fixes.length)} fixes`} ${result.gate ? 'the author chose' : 'in the default selection'}`
    return `${where} Nothing records whether ${which} ${one ? 'is' : 'are'} in it. Before other work, check each against the current code and apply the ones still missing, or tell the author which are left; a reviewer is likely to raise them.`
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
      'The author has not chosen fixes in Slopbusters yet. "Default fixes" below is the panel’s default selection, in order: fixes whose consequence is serious (money, data, a public contract, operations or security), then removals of code nothing needs, then confirmed defects and repository rules, then product and wording, then tests. "Serious consequences" lists every serious entry wherever triage put it; settle each before other work. Edge cases that need several things to go wrong are left out unless several reviewers raised them and the fix is small; a serious one is put to the author. A comment the reviewer will likely make though both models would leave the code is never in the default selection, however small: "Predicted reviewer comments" holds it with the reply to give. Problems that were already there are left for a follow-up. A question for the author takes the panel’s recommendation unless it goes against the linked ticket. A change that would undo what an earlier panel round asked for on this PR, or that another finding asks the opposite of, is never in the default selection. "Needs your decision" lists those, the ticket conflicts and what the two models could not agree on; do not act on them until the author answers.',
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
