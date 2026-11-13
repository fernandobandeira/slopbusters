import type { ReviewerId } from '../../../shared/domain/panel'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import { layerProgress, type StackReviewSession } from '../../../shared/domain/stackReview'
import { UserError } from '../../errors'
import type { StackReviewJobs } from '../stack-review/stackReviewJobs'
import { PANEL_POLL_MS } from './limits'
import { pause, target } from './panelTools'

interface Options {
  jobs: Pick<StackReviewJobs, 'start' | 'latest' | 'retry' | 'cancel'>
  /** How often a wait looks at the stack review again. */
  pollMs?: number
}

/**
 * What a coding agent can ask of a whole-stack review, answered in words it can act on. Any PR of
 * the stack names its review, because one stack has one stack review working at a time.
 */
export class StackReviewTools {
  constructor(private readonly options: Options) {}

  /** Review the stack a PR belongs to, or return the review already working on it. */
  async start(pullRequest: string, reviewers?: readonly ReviewerId[]): Promise<string> {
    const { url } = target(pullRequest)
    return report(await this.options.jobs.start(url, reviewers && [...reviewers]))
  }

  /** The stack's newest review: its brief, or how far it is after waiting up to `waitSeconds`. */
  async read(pullRequest: string, waitSeconds: number, signal: AbortSignal): Promise<string> {
    const { repository, url, name } = target(pullRequest)
    const deadline = Date.now() + waitSeconds * 1000
    for (;;) {
      const session = this.options.jobs.latest(repository, [url])
      if (!session) return `No stack review covers ${name}. Call start_stack_review to ask for one.`
      const remaining = deadline - Date.now()
      if (session.status !== 'running' || signal.aborted || remaining <= 0) return report(session)
      await pause(Math.min(this.options.pollMs ?? PANEL_POLL_MS, remaining), signal)
    }
  }

  retry(pullRequest: string): string {
    return report(this.options.jobs.retry(this.latest(pullRequest).id))
  }

  cancel(pullRequest: string): string {
    const session = this.latest(pullRequest)
    if (session.status !== 'running' && session.status !== 'partial')
      throw new UserError(`No stack review is working on ${target(pullRequest).name}.`)
    return report(this.options.jobs.cancel(session.id))
  }

  private latest(pullRequest: string): StackReviewSession {
    const { repository, url, name } = target(pullRequest)
    const session = this.options.jobs.latest(repository, [url])
    if (!session) throw new UserError(`No stack review covers ${name}.`, 404)
    return session
  }
}

/** A stack review as an agent needs it: the brief once there is one, else where each layer is. */
function report(session: StackReviewSession): string {
  const brief = session.status === 'complete' ? stackBrief(session) : undefined
  if (brief) return stackBriefMarkdown(brief, session.repository)
  const stack = `the stack review of PR #${String(session.layers[0]?.number ?? 0)} to PR #${String(session.layers.at(-1)?.number ?? 0)}`
  const layers = session.layers
    .map((layer) => `- PR #${String(layer.number)} "${layer.title}": ${layerProgress(layer)}`)
    .join('\n')
  if (session.status === 'running')
    return `${capitalized(stack)} is working. ${session.progress}\n\n${layers}\n\nCall get_stack_review with any PR of the stack to wait for the brief. Each layer's panel takes several minutes.`
  if (session.status === 'partial')
    return `${capitalized(stack)} stopped on some layers:\n${session.error ?? session.progress}\n\n${layers}\n\nCall retry_stack_review to continue from there; layers that finished are kept.`
  return `${capitalized(stack)} did not finish. ${[session.progress, session.error].filter(Boolean).join('\n')}\n\n${layers}\n\nCall retry_stack_review to run it again; panel results are kept.`
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}
