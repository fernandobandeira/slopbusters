import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { Check, CheckSquare, LoaderCircle } from 'lucide-react'
import type { RepositoryInbox, InboxPull } from '../../../shared/domain/types'
import { inboxPulls, inboxFilters as filters, type InboxFilter } from './inbox'
import {
  byOpenedDate,
  chipCount,
  filterByChips,
  inboxChips,
  toggleChip,
  type ChipContext,
  type InboxChip,
} from './inboxChips'
import { pullStatusGroup } from './inboxStatus'
import { PullRow } from './PullRow'
import { SelectionBar, type PullSelection } from './SelectionBar'

interface Props {
  repository: string
  filter: InboxFilter
  inbox?: RepositoryInbox
  inboxLoading: boolean
  statusLoading: boolean
  recommendationsError?: string
  bobReviewsError?: string
  chips: InboxChip[]
  chipContext: ChipContext
  onChips: (chips: InboxChip[]) => void
  /** PRs being picked for an action; its actions, when it has them, sit in a bar below the list. */
  selection?: PullSelection
  /** Start picking PRs for the panel. */
  onSelect?: () => void
  onFilter: (filter: InboxFilter) => void
  onResolveConflicts?: (pulls: InboxPull[]) => void
  onFixCi?: (pulls: InboxPull[]) => void
  renderPullActions: (pull: InboxPull) => ReactNode
}
export function InboxPage(props: Props) {
  const { repository, filter, inbox, inboxLoading, chips, chipContext } = props
  const tabPulls = inbox ? inboxPulls(inbox, filter) : []
  const visible = byOpenedDate(filterByChips(tabPulls, chips, chipContext))
  return (
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
              props.onFilter(item.id)
            }}
          >
            {item.label}
            <span className="count">{inbox ? inboxPulls(inbox, item.id).length : '—'}</span>
          </button>
        ))}
      </div>
      <InboxToolbar {...props} tabPulls={tabPulls} />
      <InboxWarnings {...props} />
      {inboxLoading ? (
        <div className="empty-state" role="status">
          <LoaderCircle className="animate-spin" size={22} />
          Loading open pull requests…
        </div>
      ) : visible.length ? (
        <div className="pr-list">
          {visible.map((pr) => (
            <PullRow
              key={pr.number}
              pull={pr}
              filter={filter}
              selection={rowSelection(props.selection, pr)}
              actions={props.renderPullActions(pr)}
            />
          ))}
        </div>
      ) : (
        <EmptyInbox
          repository={repository}
          filtered={Boolean(chips.length && tabPulls.length)}
          onClear={() => {
            props.onChips([])
          }}
        />
      )}
      {props.selection?.actions && <SelectionBar selection={props.selection} visible={visible} />}
    </div>
  )
}

/** The chips that filter the tab, and what can be done with the PRs they show. */
function InboxToolbar({
  filter,
  inbox,
  chips,
  chipContext,
  onChips,
  selection,
  onSelect,
  onResolveConflicts,
  onFixCi,
  tabPulls,
}: Props & { tabPulls: InboxPull[] }) {
  if (!inbox) return null
  const mine = filter === 'mine'
  const conflicts = mine ? tabPulls.filter((pull) => pullStatusGroup(pull) === 'conflicts') : []
  const failing = mine ? tabPulls.filter((pull) => pullStatusGroup(pull) === 'failing-ci') : []
  return (
    <div className="inbox-toolbar">
      <div className="inbox-chips" role="group" aria-label="Show only">
        {inboxChips.map((chip) => {
          const count = chipCount(tabPulls, chip.id, chipContext)
          return (
            <button
              key={chip.id}
              className="inbox-chip"
              aria-pressed={chips.includes(chip.id)}
              aria-label={`${chip.label} (${String(count)})`}
              onClick={() => {
                onChips(toggleChip(chips, chip.id))
              }}
            >
              {chip.label}
              <span className="count" aria-hidden="true">
                {count}
              </span>
            </button>
          )
        })}
      </div>
      <div className="inbox-toolbar-actions">
        {conflicts.length > 0 && onResolveConflicts && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onResolveConflicts(conflicts)
            }}
          >
            Resolve conflicts
          </Button>
        )}
        {failing.length > 0 && onFixCi && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onFixCi(failing)
            }}
          >
            Fix CI
          </Button>
        )}
        {!selection && onSelect && (
          <Button size="sm" variant="outline" disabled={!tabPulls.length} onClick={onSelect}>
            <CheckSquare size={13} aria-hidden="true" />
            Select
          </Button>
        )}
      </div>
    </div>
  )
}

function InboxWarnings({
  repository,
  inbox,
  inboxLoading,
  statusLoading,
  recommendationsError,
  bobReviewsError,
}: Props) {
  return (
    <>
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
      {!inboxLoading && repository && statusLoading && (
        <p role="status" className="inbox-metadata-loading">
          Loading checks and review status…
        </p>
      )}
    </>
  )
}

function EmptyInbox({
  repository,
  filtered,
  onClear,
}: {
  repository: string
  filtered: boolean
  onClear: () => void
}) {
  if (filtered)
    return (
      <div className="empty-state">
        <Check size={22} />
        <strong>No PRs match these filters</strong>
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    )
  return (
    <div className="empty-state">
      <Check size={22} />
      <strong>{repository ? 'No open PRs in this view' : 'Choose a repository to begin'}</strong>
      <span className="muted">
        {repository
          ? 'Switch tabs to see other pull requests.'
          : 'Sign in with gh auth login, then select a repository.'}
      </span>
    </div>
  )
}

function rowSelection(selection: PullSelection | undefined, pull: InboxPull) {
  if (!selection) return undefined
  const selected = selection.urls.includes(pull.url)
  return {
    purpose: selection.purpose,
    selected,
    disabled: !selected && selection.urls.length >= selection.max,
    onChange: (checked: boolean) => {
      selection.onChange(
        checked ? [...selection.urls, pull.url] : selection.urls.filter((url) => url !== pull.url),
      )
    },
  }
}
