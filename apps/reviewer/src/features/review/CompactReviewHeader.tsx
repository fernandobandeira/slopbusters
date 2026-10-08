import { ArrowRight, ArrowUpRight, GitBranch, History, RotateCw } from 'lucide-react'
import type { PullRequest } from '../../../shared/domain/types'
import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import { updateCount } from './reviewUpdates'
import type { PullStackSummary } from '../../../shared/domain/stacks'
import { StackBadge } from '../stacks/StackBadge'
import type { PullStatus } from '../../../shared/domain/pullStatus'
import { PullStatusIcons, type PullStatusSection } from '../pull-status/PullStatusIcons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

interface Props {
  pull: PullRequest
  onDescription: () => void
  onReload: () => void
  reloading: boolean
  organizing: boolean
  hasUpdates?: boolean
  updateCheckError?: string
  stack?: PullStackSummary | null
  onStack?: () => void
  status?: PullStatus
  statusError?: string
  onStatus: (section?: PullStatusSection) => void
  changes?: ReviewChanges
  onChanges?: () => void
}

export function CompactReviewHeader({ pull }: { pull: PullRequest }) {
  return (
    <header className="compact-review-header">
      <h1 title={pull.title}>{pull.title}</h1>
    </header>
  )
}

export function ReviewPullDetails({
  pull,
  onDescription,
  onReload,
  reloading,
  organizing,
  hasUpdates = false,
  updateCheckError,
  stack,
  onStack,
  status,
  statusError,
  onStatus,
  changes,
  onChanges,
}: Props) {
  const additions = pull.files.reduce((total, file) => total + file.additions, 0)
  const deletions = pull.files.reduce((total, file) => total + file.deletions, 0)

  return (
    <div className="review-pull-details" aria-label="Pull request details">
      <div className="review-pull-identity">
        <Badge size="sm" variant={pull.state === 'open' ? 'success' : 'secondary'}>
          {pull.state}
        </Badge>
        <a href={pull.url} target="_blank" rel="noreferrer">
          {pull.owner}/{pull.repo} #{pull.number}
          <ArrowUpRight size={12} />
        </a>
        {stack && <StackBadge summary={stack} onClick={onStack} />}
      </div>
      <div className="compact-review-details">
        <span className="compact-review-branches" title={`${pull.headBranch} → ${pull.baseBranch}`}>
          <GitBranch size={12} aria-hidden="true" />
          <code className="compact-review-source">{pull.headBranch}</code>
          <ArrowRight size={11} aria-hidden="true" />
          <code className="compact-review-target">{pull.baseBranch}</code>
        </span>
        <span className="compact-review-stats">
          <span>{pull.files.length} files</span>
          <span className="green">+{additions}</span>
          <span className="red">−{deletions}</span>
        </span>
        {status ? (
          <PullStatusIcons status={status} onSelect={onStatus} />
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              onStatus()
            }}
            title={statusError}
          >
            {statusError ? 'Status unavailable' : 'Checks and reviews'}
          </Button>
        )}
        <ReviewUpdatesButton changes={changes} onClick={onChanges} />
        <Button size="xs" variant="ghost" onClick={onDescription}>
          PR description
        </Button>
        <ReloadButton
          onReload={onReload}
          reloading={reloading}
          disabled={organizing || reloading}
          hasUpdates={hasUpdates}
          updateCheckError={updateCheckError}
        />
      </div>
    </div>
  )
}

/** The one place review updates surface outside their group. */
function ReviewUpdatesButton({
  changes,
  onClick,
}: {
  changes?: ReviewChanges
  onClick?: () => void
}) {
  const count = updateCount(changes)
  if (!changes || !count) return null
  const baseline = changes.baselineHeadSha.slice(0, 7)
  const incomplete = changes.incompletePaths?.length ?? 0
  return (
    <Button
      className="review-updates-button"
      size="xs"
      variant="outline"
      onClick={onClick}
      title={[
        `Compared with your review of ${baseline}.`,
        incomplete
          ? `${incomplete} ${incomplete === 1 ? 'file has' : 'files have'} incomplete patches and could not be fully compared.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <History size={12} aria-hidden="true" />
      {count} updated since {baseline}
    </Button>
  )
}

function ReloadButton({
  onReload,
  reloading,
  disabled,
  hasUpdates,
  updateCheckError,
}: {
  onReload: () => void
  reloading: boolean
  disabled: boolean
  hasUpdates: boolean
  updateCheckError?: string
}) {
  return (
    <Button
      size={hasUpdates ? 'sm' : 'xs'}
      variant={hasUpdates ? 'default' : 'ghost'}
      onClick={onReload}
      disabled={disabled}
      title={
        hasUpdates
          ? 'The PR has changed. Load the latest revision; unchanged diffs retain viewed status.'
          : updateCheckError
            ? `Update check failed: ${updateCheckError}. Reload to try again.`
            : 'Check for and load the latest revision'
      }
      aria-live="polite"
    >
      <RotateCw size={12} className={reloading ? 'animate-spin' : undefined} />
      {reloading ? 'Loading…' : hasUpdates ? 'Updates available' : 'Reload'}
    </Button>
  )
}
