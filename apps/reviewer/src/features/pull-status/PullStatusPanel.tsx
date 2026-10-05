import { Check, CheckCircle2, ChevronRight, CircleDashed, Clock3, ExternalLink, GitMerge, GitPullRequestClosed, GitPullRequestDraft, HelpCircle, ShieldCheck, Users, XCircle } from 'lucide-react'
import type { PullCheck, PullReviewer, PullStatus } from '../../../shared/domain/pullStatus'
import type { PullStatusSection } from './PullStatusIcons'
import '../../pullStatus.css'

export function readinessPresentation(status: PullStatus) {
  if (status.readiness === 'merged') return { label: 'Merged', tone: 'merged', Icon: GitMerge }
  if (status.readiness === 'closed')
    return { label: 'Closed', tone: 'failed', Icon: GitPullRequestClosed }
  if (status.isDraft) return { label: 'Draft', tone: 'muted', Icon: GitPullRequestDraft }
  switch (status.readiness) {
    case 'ready':
      return { label: 'Ready to merge', tone: 'success', Icon: CheckCircle2 }
    case 'not-ready':
      return { label: 'Not ready', tone: 'warning', Icon: CircleDashed }
    case 'checking':
      return { label: 'Checking', tone: 'pending', Icon: Clock3 }
    default:
      return { label: 'Readiness unknown', tone: 'muted', Icon: HelpCircle }
  }
}

export function PullReadinessBadge({
  status,
  onClick,
  showDraft = true,
}: {
  status: PullStatus
  onClick?: () => void
  showDraft?: boolean
}) {
  const { label, tone, Icon } =
    !showDraft && status.isDraft && status.readiness !== 'merged' && status.readiness !== 'closed'
      ? { label: 'Not ready', tone: 'warning', Icon: CircleDashed }
      : readinessPresentation(status)
  const title = [label, ...status.reasons].join('. ')
  const contents = (
    <>
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </>
  )
  if (!onClick)
    return (
      <span className={`pull-readiness pull-tone-${tone}`} title={title}>
        {contents}
      </span>
    )
  return (
    <button
      type="button"
      className={`pull-readiness pull-tone-${tone}`}
      title={title}
      aria-label={`View pull request status: ${label}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      {contents}
    </button>
  )
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}

function checkPresentation(check: PullCheck) {
  if (check.status === 'queued') return { label: 'Queued', tone: 'pending', Icon: Clock3 }
  if (check.status === 'in-progress') return { label: 'In progress', tone: 'pending', Icon: Clock3 }
  const conclusion = check.conclusion?.toLowerCase().replaceAll('_', '-')
  switch (conclusion) {
    case 'success':
      return { label: 'Passed', tone: 'success', Icon: CheckCircle2 }
    case 'failure':
    case 'error':
      return { label: 'Failed', tone: 'failed', Icon: XCircle }
    case 'timed-out':
      return { label: 'Timed out', tone: 'failed', Icon: XCircle }
    case 'action-required':
      return { label: 'Action required', tone: 'warning', Icon: CircleDashed }
    case 'startup-failure':
      return { label: 'Startup failed', tone: 'failed', Icon: XCircle }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted', Icon: CircleDashed }
    case 'skipped':
      return { label: 'Skipped', tone: 'muted', Icon: CircleDashed }
    case 'neutral':
      return { label: 'Neutral', tone: 'muted', Icon: CircleDashed }
    case 'stale':
      return { label: 'Stale', tone: 'warning', Icon: CircleDashed }
    default:
      return { label: 'Status unknown', tone: 'muted', Icon: HelpCircle }
  }
}

function checkSummary(checks: PullCheck[]): string {
  if (!checks.length) return 'No checks reported'
  const counts = { success: 0, failed: 0, pending: 0, other: 0 }
  for (const check of checks) {
    const tone = checkPresentation(check).tone
    if (tone === 'success' || tone === 'failed' || tone === 'pending') counts[tone]++
    else counts.other++
  }
  return [
    counts.success && `${counts.success} passing`,
    counts.failed && `${counts.failed} failing`,
    counts.pending && `${counts.pending} pending`,
    counts.other && `${counts.other} other`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function reviewerPresentation(reviewer: PullReviewer) {
  switch (reviewer.state) {
    case 'approved':
      return { label: 'Approved', tone: 'success', Icon: CheckCircle2 }
    case 'changes-requested':
      return { label: 'Changes requested', tone: 'failed', Icon: XCircle }
    case 'requested':
      return { label: 'Review requested', tone: 'pending', Icon: Clock3 }
    case 'pending':
      return { label: 'Review pending', tone: 'pending', Icon: Clock3 }
    case 'dismissed':
      return { label: 'Review dismissed', tone: 'muted', Icon: CircleDashed }
    default:
      return { label: 'Commented', tone: 'muted', Icon: Check }
  }
}

function reviewSummary(status: PullStatus): string {
  switch (status.reviewDecision) {
    case 'APPROVED':
      return 'Review approved'
    case 'CHANGES_REQUESTED':
      return 'Changes requested'
    case 'REVIEW_REQUIRED':
      return 'Required review missing'
    default:
      return status.reviewers.some(
        (reviewer) => reviewer.state === 'requested' || reviewer.state === 'pending',
      )
        ? 'Awaiting review'
        : status.requirementsKnown &&
            status.requiredApprovals === 0 &&
            !status.requiresCodeOwnerReviews
          ? 'No required reviews'
          : 'No review decision reported'
  }
}

interface Props {
  status: PullStatus
  compact?: boolean
  section?: PullStatusSection
  pullUrl?: string
}

export function PullStatusPanel({ status, compact = false, section, pullUrl }: Props) {
  const { tone } = readinessPresentation(status)
  const focused = Boolean(section && section !== 'overview')
  const showChecks = !focused || section === 'checks'
  const showReviews = !focused || section === 'reviews' || section === 'changes'
  const reviewers =
    section === 'changes'
      ? status.reviewers.filter((reviewer) => reviewer.state === 'changes-requested')
      : status.reviewers
  const url = safeUrl(pullUrl)
  if (section === 'conflicts')
    return (
      <section className="pull-status-panel pull-focused-status" aria-label="Merge conflicts">
        <h3>Merge conflicts</h3>
        <p>
          {status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY'
            ? 'Conflicts with the base branch must be resolved before this PR can merge.'
            : status.mergeable === 'MERGEABLE'
              ? 'No merge conflicts reported.'
              : 'GitHub has not confirmed mergeability.'}
        </p>
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            View on GitHub <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </section>
    )
  if (section === 'comments')
    return (
      <section
        className="pull-status-panel pull-focused-status"
        aria-label="Unresolved review comments"
      >
        <h3>Unresolved review comments</h3>
        {status.unresolvedReviewThreads == null ? (
          <p>The unresolved thread count is unavailable.</p>
        ) : status.unresolvedReviewThreads === 0 ? (
          <p>No unresolved review threads.</p>
        ) : (
          <p>
            {status.unresolvedReviewThreads} unresolved review{' '}
            {status.unresolvedReviewThreads === 1 ? 'thread' : 'threads'}.
          </p>
        )}
        <ul className="pull-comment-list">
          {(status.unresolvedThreads ?? []).map((thread) => {
            const threadUrl = safeUrl(thread.url)
            return (
              <li key={thread.id}>
                <div className="pull-comment-location">
                  <code>
                    {thread.path}
                    {thread.line !== null ? `:${thread.line}` : ''}
                  </code>
                  {thread.outdated && <span>Outdated</span>}
                </div>
                {thread.author && <span className="pull-comment-author">@{thread.author}</span>}
                <p>{thread.body}</p>
                {threadUrl && (
                  <a href={threadUrl} target="_blank" rel="noreferrer">
                    View thread <ExternalLink size={10} aria-hidden="true" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
        {url && (
          <a href={`${url}/files`} target="_blank" rel="noreferrer">
            View comments on GitHub <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
        {status.warnings.map((warning) => (
          <p className="pull-status-warning" role="status" key={warning}>
            {warning}
          </p>
        ))}
      </section>
    )
  return (
    <section
      className={`pull-status-panel ${compact ? 'pull-status-compact' : ''}`}
      aria-label="Pull request readiness"
    >
      {!compact && !focused && (
        <div className="pull-status-heading">
          <ShieldCheck size={16} aria-hidden="true" />
          <h2>Merge readiness</h2>
          <PullReadinessBadge status={status} />
        </div>
      )}
      {!focused && status.reasons.length > 0 && (
        <ul className="pull-status-reasons" data-tone={tone}>
          {status.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {showChecks && (
        <details className="pull-status-section" open={focused || !compact}>
          <summary>
            <ChevronRight size={13} aria-hidden="true" />
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>Checks</span>
            <span className="pull-status-summary">{checkSummary(status.checks)}</span>
          </summary>
          <ul className="pull-check-list">
            {status.checks.map((check, index) => {
              const { Icon, label, tone } = checkPresentation(check)
              const url = safeUrl(check.url)
              return (
                <li key={`${check.kind}:${check.name}:${index}`} className="pull-check-row">
                  <Icon size={14} aria-hidden="true" className={`pull-tone-${tone}`} />
                  <span className="pull-check-name">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {check.name}
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    ) : (
                      check.name
                    )}
                    {check.required && <span className="pull-required-label">Required</span>}
                  </span>
                  <span className={`pull-check-conclusion pull-tone-${tone}`}>{label}</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {showReviews && (
        <details className="pull-status-section" open={focused || !compact}>
          <summary>
            <ChevronRight size={13} aria-hidden="true" />
            <Users size={14} aria-hidden="true" />
            <span>{section === 'changes' ? 'Changes requested' : 'Reviewers'}</span>
            <span className="pull-status-summary">
              {section === 'changes'
                ? `${reviewers.length} ${reviewers.length === 1 ? 'reviewer' : 'reviewers'}`
                : reviewSummary(status)}
            </span>
          </summary>
          {section !== 'changes' && (
            <div className="pull-review-requirements">
              {!status.requirementsKnown && <span>Review requirements unavailable.</span>}
              {status.requiredApprovals !== null && status.requiredApprovals > 0 && (
                <span>
                  Requires {status.requiredApprovals}{' '}
                  {status.requiredApprovals === 1 ? 'approval' : 'approvals'}.
                </span>
              )}
              {status.requiresCodeOwnerReviews && <span>Code owner review required.</span>}
            </div>
          )}
          {!reviewers.length && (
            <p className="pull-no-reviewers">
              {section === 'changes'
                ? 'No reviewers with outstanding changes requested were reported.'
                : 'No reviewers reported.'}
            </p>
          )}
          <ul className="pull-reviewer-list">
            {reviewers.map((reviewer) => {
              const { Icon, label, tone } = reviewerPresentation(reviewer)
              const url = safeUrl(reviewer.url)
              const avatar = safeUrl(reviewer.avatarUrl)
              return (
                <li key={`${reviewer.type}:${reviewer.login}`} className="pull-reviewer-row">
                  {avatar ? (
                    <img src={avatar} alt="" width={20} height={20} loading="lazy" />
                  ) : (
                    <Users size={16} aria-hidden="true" />
                  )}
                  <span className="pull-reviewer-name">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        @{reviewer.login}
                      </a>
                    ) : (
                      `@${reviewer.login}`
                    )}
                    {reviewer.type === 'team' && <span className="pull-required-label">Team</span>}
                  </span>
                  <span className={`pull-reviewer-decision pull-tone-${tone}`}>
                    <Icon size={12} aria-hidden="true" />
                    {label}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {status.warnings.map((warning) => (
        <p className="pull-status-warning" role="status" key={warning}>
          {warning}
        </p>
      ))}
    </section>
  )
}
