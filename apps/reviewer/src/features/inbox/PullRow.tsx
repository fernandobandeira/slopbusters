import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import type { InboxPull } from '../../../shared/domain/types'
import { reviewPath } from '../../lib/routes'
import type { InboxFilter } from './inbox'

interface Props {
  pull: InboxPull
  filter: InboxFilter
  selection?: { selected: boolean; disabled: boolean; onChange: (checked: boolean) => void }
  actions: ReactNode
}
export function PullRow({ pull: pr, filter, selection, actions }: Props) {
  return (
    <div className={`pr-row${Boolean(selection) && selection?.selected ? ' pr-row-selected' : ''}`}>
      {Boolean(selection) && (
        <input
          className="pr-selection-checkbox"
          type="checkbox"
          aria-label={`Select PR #${pr.number} for Linus`}
          checked={selection?.selected}
          disabled={!selection?.selected && selection?.disabled}
          onChange={(event) => selection?.onChange(event.target.checked)}
        />
      )}
      <Link className="pr-row-link" to={reviewPath({ url: pr.url, filter })}>
        {pr.isDraft ? (
          <GitPullRequestDraft
            size={19}
            className="muted"
            aria-label="Draft pull request"
            aria-hidden={false}
            role="img"
          />
        ) : (
          <GitPullRequest
            size={19}
            className="green"
            aria-label="Open pull request"
            aria-hidden={false}
            role="img"
          />
        )}
        <div>
          <strong>{pr.title}</strong>
          <span className="muted">
            #{pr.number} opened by {pr.author} · updated{' '}
            {new Date(pr.updatedAt).toLocaleDateString()}
          </span>
        </div>
        {pr.reviewRequested && <Badge variant="info">Your review requested</Badge>}
      </Link>
      {actions}
      <a
        className="pr-external-link muted"
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open PR #${pr.number} on GitHub`}
        title="Open on GitHub"
      >
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </div>
  )
}
