import type { ReactNode } from 'react'
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
  selectingForLinus: boolean
  selectedLinusUrls: string[]
  onSelectionChange: (urls: string[]) => void
  onFilter: (filter: InboxFilter) => void
  renderPullActions: (pull: InboxPull) => ReactNode
}
export function InboxPage({
  repository,
  filter,
  inbox,
  inboxLoading,
  statusLoading,
  recommendationsError,
  selectingForLinus,
  selectedLinusUrls,
  onSelectionChange,
  onFilter,
  renderPullActions,
}: Props) {
  const visible = inbox ? inboxPulls(inbox, filter) : []
  const sections =
    filter === 'mine' ? [{ id: 'all', label: '', pulls: visible }] : inboxSections(visible)
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
        {inbox?.warnings?.map((warning) => (
          <p key={warning} role="status" className="inbox-warning">
            {warning}
          </p>
        ))}
        {!inboxLoading && repository && statusLoading && filter !== 'mine' && (
          <p role="status" className="inbox-metadata-loading">
            Loading checks and review status…
          </p>
        )}
        {inboxLoading ? (
          <div className="empty-state" role="status">
            <LoaderCircle className="animate-spin" size={22} />
            Loading open pull requests…
          </div>
        ) : visible.length ? (
          <div className="pr-list">
            {sections.map((section) => (
              <section
                className="inbox-section"
                key={section.id}
                aria-label={section.label || 'Pull requests'}
              >
                {section.label && (
                  <h2 className="inbox-section-title">
                    {section.id === 'unknown' && statusLoading ? 'Checking status' : section.label}
                    <span>{section.pulls.length}</span>
                  </h2>
                )}
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
