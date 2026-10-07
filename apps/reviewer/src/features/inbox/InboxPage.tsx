import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { Check, LoaderCircle } from 'lucide-react'
import type { RepositoryInbox, InboxPull } from '../../../shared/domain/types'
import { inboxPulls, inboxFilters as filters, type InboxFilter } from './inbox'
import { inboxSections } from './inboxSections'
import { PullRow } from './PullRow'

interface Props {
  repository: string
  filter: InboxFilter
  inbox?: RepositoryInbox
  inboxLoading: boolean
  statusLoading: boolean
  recommendationsError?: string
  bobReviewsError?: string
  selectingForLinus: boolean
  selectedLinusUrls: string[]
  onSelectionChange: (urls: string[]) => void
  onFilter: (filter: InboxFilter) => void
  onResolveConflicts?: (pulls: InboxPull[]) => void
  onFixCi?: (pulls: InboxPull[]) => void
  renderPullActions: (pull: InboxPull) => ReactNode
}
export function InboxPage({
  repository,
  filter,
  inbox,
  inboxLoading,
  statusLoading,
  recommendationsError,
  bobReviewsError,
  selectingForLinus,
  selectedLinusUrls,
  onSelectionChange,
  onFilter,
  renderPullActions,
  onResolveConflicts,
  onFixCi,
}: Props) {
  const visible = inbox ? inboxPulls(inbox, filter) : []
  const sections = inboxSections(visible)
  return (
    <>
      <div className="inbox-content">
        <div className="eyebrow">YOUR REVIEW WORKSPACE</div>
        <h1>Pull requests</h1>
        <p className="muted">Pick a change. Read the code. Leave useful feedback.</p>
        <div className="inbox-tabs" role="tablist" aria-label="Inbox filter">
          {filters.map((item) => (
            <button
              role="tab"
              aria-selected={item.id === filter}
              key={item.id}
              onClick={() => {
                onFilter(item.id)
              }}
            >
              {item.label}
              <span className="count">{inbox ? inboxPulls(inbox, item.id).length : '—'}</span>
            </button>
          ))}
        </div>
        {recommendationsError && (
          <p role="status" className="inbox-warning">
            Could not load Linus recommendations: {recommendationsError}
          </p>
        )}
        {bobReviewsError && (
          <p role="status" className="inbox-warning">
            Could not load saved Uncle Bob reviews: {bobReviewsError}
          </p>
        )}
        {inbox?.warnings?.map((warning) => (
          <p key={warning} role="status" className="inbox-warning">
            {warning}
          </p>
        ))}
        <InboxMetadataStatus
          loading={inboxLoading}
          repository={repository}
          statusLoading={statusLoading}
        />
        {inboxLoading ? (
          <div className="empty-state" role="status">
            <LoaderCircle className="animate-spin" size={22} />
            Loading open pull requests…
          </div>
        ) : visible.length ? (
          <div className="pr-list">
            {sections.map((section) => (
              <section className="inbox-section" key={section.id} aria-label={section.label}>
                <div className="inbox-conflict-heading">
                  <h2 className="inbox-section-title">
                    {section.id === 'unknown' && statusLoading ? 'Checking status' : section.label}
                    <span>{section.pulls.length}</span>
                  </h2>
                  {section.id === 'conflicts' && filter === 'mine' && onResolveConflicts && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onResolveConflicts(section.pulls)
                      }}
                    >
                      Resolve conflicts
                    </Button>
                  )}
                  {section.id === 'failing-ci' && filter === 'mine' && onFixCi && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onFixCi(section.pulls)
                      }}
                    >
                      Fix CI
                    </Button>
                  )}
                </div>
                {section.pulls.map((pr) => (
                  <PullRow
                    key={pr.number}
                    pull={pr}
                    filter={filter}
                    selection={
                      selectingForLinus
                        ? {
                            selected: selectedLinusUrls.includes(pr.url),
                            disabled: selectedLinusUrls.length >= 20,
                            onChange: (checked) => {
                              onSelectionChange(
                                checked
                                  ? [...selectedLinusUrls, pr.url]
                                  : selectedLinusUrls.filter((url) => url !== pr.url),
                              )
                            },
                          }
                        : undefined
                    }
                    actions={renderPullActions(pr)}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Check size={22} />
            <strong>
              {repository ? 'No open PRs in this view' : 'Choose a repository to begin'}
            </strong>
            <span className="muted">
              {repository
                ? 'Switch tabs to see other pull requests.'
                : 'Sign in with gh auth login, then select a repository.'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}

function InboxMetadataStatus({
  loading,
  repository,
  statusLoading,
  enabled = true,
}: {
  loading: boolean
  repository: string
  statusLoading: boolean
  enabled?: boolean
}) {
  if (loading || !repository || !statusLoading || !enabled) return null
  return (
    <p role="status" className="inbox-metadata-loading">
      Loading checks and review status…
    </p>
  )
}
