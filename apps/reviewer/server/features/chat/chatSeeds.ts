import type { PreparedPullRequest } from '../../adapters/t3Engine/engineThreads'
import { UserError } from '../../errors'
import { MAX_CHAT_REVIEW_CHARACTERS } from '../../limits'
import { clip } from '../tickets/tickets'
import { gandalfSessionMarkdown, jobsReviewMarkdown, linusReviewMarkdown } from './reviewMarkdown'
import { bobReviewMarkdown, type BobSession } from '../../../shared/domain/bob'
import type { ContinueChatRequest } from '../../../shared/domain/chat'
import type { GandalfSession } from '../../../shared/domain/gandalf'
import { latestJobsAdvice, type JobsSession } from '../../../shared/domain/jobs'
import type { LinusSession } from '../../../shared/domain/linus'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { ReviewSession } from '../../../shared/domain/reviewSession'
import { Provider, type PullRequest } from '../../../shared/domain/types'

/** Where each persona keeps the sessions a chat can continue. */
export interface ReviewSessions {
  linus: { get(id: string): LinusSession }
  bob: { get(id: string): BobSession }
  jobs: { get(id: string): JobsSession }
  gandalf: { get(id: string): GandalfSession }
}

export type Checkout = Pick<PreparedPullRequest, 'branch' | 'worktreePath' | 'onPullRequestHead'>
export interface PullSubject {
  url: string
  owner: string
  repo: string
  number: number
  title: string
  /** Known for reviewed PRs; tells whether a reused checkout is at the PR head. */
  headSha?: string
}

/** What a chat starts from: where it works, its title, and the first message. */
export type ChatSeed =
  | {
      kind: 'pull'
      title: string
      pull: PullSubject
      message: (provider: Provider, checkout: Checkout) => string
    }
  | {
      kind: 'repository'
      title: string
      repository: { owner: string; repo: string }
      message: (provider: Provider) => string
    }

const HANDOVER = 'Pick up from this review. Wait for my questions.'

/** The review a chat continues, or a refusal when it has no result for that PR or issue yet. */
export function chatSeed(sessions: ReviewSessions, request: ContinueChatRequest): ChatSeed {
  switch (request.persona) {
    case 'linus':
      return linusSeed(sessions.linus.get(request.sessionId), request.url)
    case 'unclebob':
      return bobSeed(sessions.bob.get(request.sessionId))
    case 'jobs':
      return jobsSeed(sessions.jobs.get(request.sessionId))
    case 'gandalf':
      return gandalfSeed(sessions.gandalf.get(request.sessionId), request.url)
  }
}

function linusSeed(session: LinusSession, url: string): ChatSeed {
  const review = reviewOf(session, url)
  if (!review) throw new UserError('Linus has not finished reviewing this PR yet.')
  const { pull, advice, partial } = review
  return {
    kind: 'pull',
    title: `Linus · #${String(pull.number)} ${pull.title}`,
    pull,
    message: (provider, checkout) =>
      paragraphs(
        `${invocation('linus', provider)} Use review-only mode for ${subject(pull)}`,
        checkoutLine(pull, checkout),
        reviewedLine(pull, partial),
        clip(linusReviewMarkdown(advice), MAX_CHAT_REVIEW_CHARACTERS),
        HANDOVER,
      ),
  }
}

function bobSeed(session: BobSession): ChatSeed {
  const review = reviewOf(session, session.urls[0] ?? '')
  if (!review) throw new UserError('Uncle Bob has not finished reviewing this PR yet.')
  const { pull, advice, partial } = review
  return {
    kind: 'pull',
    title: `Uncle Bob · #${String(pull.number)} ${pull.title}`,
    pull,
    message: (provider, checkout) =>
      paragraphs(
        `${invocation('unclebob', provider)} Review ${subject(pull)}`,
        `${checkoutLine(pull, checkout)} Review its changes with \`git diff origin/${pull.baseBranch}...HEAD\`.`,
        reviewedLine(pull, partial),
        clip(bobReviewMarkdown(advice), MAX_CHAT_REVIEW_CHARACTERS),
        HANDOVER,
      ),
  }
}

function jobsSeed(session: JobsSession): ChatSeed {
  const review = jobsReviewOf(session)
  if (!review) throw new UserError('Steve Jobs has not finished reviewing this issue yet.')
  const [owner, repo] = session.repository.split('/')
  if (!owner || !repo) throw new UserError('Choose the repository this issue belongs to first.')
  const issue = session.snapshot ?? { identifier: session.ticket, title: '', url: '' }
  const named = `Linear issue ${issue.identifier}${issue.title ? `, "${issue.title}"` : ''}`
  return {
    kind: 'repository',
    title: `Jobs · ${issue.identifier}${issue.title ? ` ${issue.title}` : ''}`,
    repository: { owner, repo },
    message: (provider) =>
      paragraphs(
        `${invocation('jobs', provider)} Use review-only mode for ${named}${issue.url ? `: ${issue.url}` : ''}`,
        `This is a checkout of ${owner}/${repo}. Check claims about the code against its default branch, and do not change any files.`,
        `You already reviewed this issue in Slopbusters.${review.partial ? ' One of the two reviewers did not finish, so this is the review that did.' : ''} This is the review you wrote there:`,
        clip(jobsReviewMarkdown(review.advice, review.answers), MAX_CHAT_REVIEW_CHARACTERS),
        HANDOVER,
      ),
  }
}

function gandalfSeed(session: GandalfSession, url: string): ChatSeed {
  const result = session.results.find((item) => item.url === url)
  if (!result) throw new UserError('Gandalf has not finished with this PR yet.')
  const pull = { ...parsePullUrl(url), url, number: result.number, title: result.title }
  const work =
    session.task === 'ci'
      ? 'worked on the failing CI checks of'
      : 'worked on the merge conflicts of'
  return {
    kind: 'pull',
    title: `Gandalf · #${String(pull.number)} ${pull.title}`,
    pull,
    message: (_provider, checkout) =>
      paragraphs(
        `You are Gandalf. In Slopbusters you ${work} ${subject(pull)}`,
        checkoutDescription(checkout),
        'This is what you reported there:',
        clip(gandalfSessionMarkdown(session, url), MAX_CHAT_REVIEW_CHARACTERS),
        'Commit any change you make and explain each one. Do not push; I will review the commits first.',
        HANDOVER,
      ),
  }
}

/** A PR's reconciled review, or for a partial session the advice of the reviewer that finished. */
function reviewOf<Advice>(session: ReviewSession<Advice>, url: string) {
  const result = session.results.find((item) => item.pull.url === url)
  if (result) return { pull: result.pull, advice: result.advice, partial: false }
  const pending = session.status === 'partial' ? session.pending : undefined
  const advice =
    pending?.pull.url === url && pending.reviews.find((review) => review.advice)?.advice
  return pending && advice ? { pull: pending.pull, advice, partial: true } : undefined
}

function jobsReviewOf(session: JobsSession) {
  const pending = session.status === 'partial' ? session.pending : undefined
  const available = pending?.reviews.find((review) => review.advice)?.advice
  if (pending && available) return { advice: available, answers: pending.answers, partial: true }
  const revision = latestJobsAdvice(session)
  return revision && { advice: revision.advice, answers: revision.answers, partial: false }
}

function subject(pull: Pick<PullSubject, 'number' | 'title' | 'url'>): string {
  return `PR #${String(pull.number)}, "${pull.title}": ${pull.url}`
}

function checkoutLine(pull: PullRequest, checkout: Checkout): string {
  return `${checkoutDescription(checkout)} It targets ${pull.baseBranch}.`
}

/** Where the thread works: its own worktree, or the user's checkout when it was already on the PR branch. */
function checkoutDescription(checkout: Checkout): string {
  if (checkout.worktreePath)
    return checkout.onPullRequestHead
      ? `This worktree has the PR head checked out on branch ${checkout.branch}.`
      : `This worktree is on branch ${checkout.branch}, but it kept local commits or changes and may not match the PR head; say so if that gets in the way.`
  const state = checkout.onPullRequestHead
    ? 'at the PR head with no uncommitted changes'
    : 'but it has uncommitted changes or is not at the PR head; say so if that gets in the way'
  return `This is my own checkout of the repository, already on the PR branch ${checkout.branch}, ${state}. Do not discard, reset, stash or overwrite changes you did not make.`
}

function reviewedLine(pull: PullRequest, partial: boolean): string {
  return [
    `You already reviewed this PR in Slopbusters, at head ${pull.headSha.slice(0, 7)}; if the head has moved since, say what changed before relying on it.`,
    partial && 'One of the two reviewers did not finish, so this is the review that did.',
    'This is the review you wrote there:',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Claude Code expands a leading `/skill`; Codex reads `$skill`. */
function invocation(skill: 'linus' | 'unclebob' | 'jobs', provider: Provider): string {
  return `${provider === Provider.claude ? '/' : '$'}slopbusters:${skill}`
}

function paragraphs(...parts: string[]): string {
  return parts.join('\n\n')
}
