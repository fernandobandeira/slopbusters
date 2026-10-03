import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock3,
  GitMerge,
  MessageCircle,
  MessageSquareWarning,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import type { PullStatus } from '../shared/pullStatus'
import './pullStatus.css'

export type PullStatusSection =
  'conflicts' | 'checks' | 'reviews' | 'changes' | 'comments' | 'overview'

function checksIndicator(status: PullStatus) {
  const failed = status.checks.some((check) =>
    [
      'FAILURE',
      'ERROR',
      'TIMED_OUT',
      'TIMED-OUT',
      'STARTUP_FAILURE',
      'STARTUP-FAILURE',
      'ACTION_REQUIRED',
      'ACTION-REQUIRED',
    ].includes(check.conclusion?.toUpperCase() ?? ''),
  )
  if (failed || ['FAILURE', 'ERROR'].includes(status.checksState ?? ''))
    return { Icon: CircleX, tone: 'failed', label: 'CI checks failed' }
  if (
    ['PENDING', 'EXPECTED'].includes(status.checksState ?? '') ||
    status.checks.some((check) => check.status !== 'completed')
  )
    return { Icon: Clock3, tone: 'warning', label: 'CI checks pending' }
  if (status.checksState === 'SUCCESS')
    return { Icon: CircleCheck, tone: 'success', label: 'CI checks passed' }
  return { Icon: CircleHelp, tone: 'muted', label: 'CI status unavailable' }
}

interface Props {
  status: PullStatus
  onSelect: (section: PullStatusSection) => void
  expandedSection?: PullStatusSection
  inline?: boolean
  controlsId?: string
}

export function PullStatusIcons({
  status,
  onSelect,
  expandedSection,
  inline = false,
  controlsId,
}: Props) {
  const indicators: {
    section: PullStatusSection
    Icon: typeof CircleCheck
    tone: string
    label: string
    count?: number
  }[] = []
  if (status.unresolvedReviewThreads != null && status.unresolvedReviewThreads > 0)
    indicators.push({
      section: 'comments',
      Icon: MessageCircle,
      tone: 'warning',
      label: `${status.unresolvedReviewThreads} unresolved review ${status.unresolvedReviewThreads === 1 ? 'thread' : 'threads'}`,
      count: status.unresolvedReviewThreads,
    })
  if (status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY')
    indicators.push({
      section: 'conflicts',
      Icon: GitMerge,
      tone: 'failed',
      label: 'Merge conflicts',
    })
  const changesRequested =
    status.reviewDecision === 'CHANGES_REQUESTED' ||
    (status.reviewDecision === null &&
      status.reviewers.some((reviewer) => reviewer.state === 'changes-requested'))
  if (changesRequested)
    indicators.push({
      section: 'changes',
      Icon: MessageSquareWarning,
      tone: 'failed',
      label: 'Changes requested',
    })
  else if (status.reviewDecision === 'REVIEW_REQUIRED')
    indicators.push({
      section: 'reviews',
      Icon: Users,
      tone: 'warning',
      label: 'Required reviews missing',
    })
  else if (status.reviewDecision === 'APPROVED')
    indicators.push({
      section: 'reviews',
      Icon: UserRoundCheck,
      tone: 'success',
      label: 'Review approved',
    })
  else if (status.reviewDecision === null)
    indicators.push({
      section: 'reviews',
      Icon: Users,
      tone: 'muted',
      label: status.reviewers.some(
        (reviewer) => reviewer.state === 'requested' || reviewer.state === 'pending',
      )
        ? 'Review requested'
        : status.requirementsKnown &&
            status.requiredApprovals === 0 &&
            !status.requiresCodeOwnerReviews
          ? 'No required reviews'
          : 'Review status unavailable',
    })
  indicators.push({ section: 'checks', ...checksIndicator(status) })

  return (
    <span className="pull-status-icons" role="group" aria-label="Pull request status">
      {indicators.map(({ section, Icon, tone, label, count }) => (
        <button
          key={section}
          type="button"
          className={`pull-status-icon pull-tone-${tone}`}
          aria-label={label}
          title={label}
          aria-haspopup={inline ? undefined : 'dialog'}
          aria-expanded={inline ? expandedSection === section : undefined}
          aria-controls={inline && expandedSection === section ? controlsId : undefined}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelect(section)
          }}
        >
          <Icon size={14} aria-hidden="true" />
          {count !== undefined && <span className="pull-status-icon-count">{count}</span>}
        </button>
      ))}
    </span>
  )
}
