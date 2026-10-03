import { ArrowRight, ArrowUpRight, GitBranch, RotateCw } from 'lucide-react'
import type { PullRequest } from '../shared/types'
import type { PullStackSummary } from '../shared/stacks'
import { StackBadge } from './StackBadge'
import type { PullStatus } from '../shared/pullStatus'
import { PullStatusIcons, type PullStatusSection } from './PullStatusIcons'
import { Badge } from './vendor/t3/components/ui/badge'
import { Button } from './vendor/t3/components/ui/button'

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
}

export function CompactReviewHeader({
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
}: Props) {
  const additions = pull.files.reduce((total, file) => total + file.additions, 0)
  const deletions = pull.files.reduce((total, file) => total + file.deletions, 0)

  return (
    <header className="compact-review-header">
      <div className="compact-review-title">
        <Badge size="sm" variant={pull.state === 'open' ? 'success' : 'secondary'}>
          {pull.state}
        </Badge>
        <a href={pull.url} target="_blank" rel="noreferrer">
          {pull.owner}/{pull.repo} #{pull.number}
          <ArrowUpRight size={12} />
        </a>
        <h1 title={pull.title}>{pull.title}</h1>
        {stack && <StackBadge summary={stack} onClick={onStack} compact />}
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
          <Button size="xs" variant="ghost" onClick={() => onStatus()} title={statusError}>
            {statusError ? 'Status unavailable' : 'Checks and reviews'}
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={onDescription}>
          PR description
        </Button>
        <Button
          size={hasUpdates ? 'sm' : 'xs'}
          variant={hasUpdates ? 'default' : 'ghost'}
          onClick={onReload}
          disabled={organizing || reloading}
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
      </div>
    </header>
  )
}
