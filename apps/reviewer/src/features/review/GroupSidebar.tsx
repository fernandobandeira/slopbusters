import { Link } from 'react-router'
import { ArrowLeft, Check, History, RotateCw, X } from 'lucide-react'
import type { ChangeGroup, PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { groupChangeTotals } from '../../../shared/domain/review'
import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import { groupIsViewed, reviewedHunkIds } from './reviewProgress'

interface Props {
  pull: PullRequest
  draft: ReviewDraft
  changes?: ReviewChanges
  updates?: ChangeGroup
  selectedId?: string
  inboxUrl: string
  submitting: boolean
  organizing: boolean
  onSelect: (id?: string) => void
  onRegenerate: () => void
  onNotice: (message: string) => void
  onDismissUpdates?: () => void
}
export function GroupSidebar({
  pull,
  draft,
  changes,
  updates,
  selectedId,
  inboxUrl,
  submitting,
  organizing,
  onSelect,
  onRegenerate,
  onNotice,
  onDismissUpdates,
}: Props) {
  const groups = pull.groups
  const grouped = pull.groupingSource !== 'files'
  const reviewed = reviewedHunkIds(pull, draft)
  const selected = groups.find((group) => group.id === selectedId)
  return (
    <aside className="group-sidebar" aria-label="Review navigation">
      <div className="review-navigation">
        <Link
          className="back-to-inbox"
          to={inboxUrl}
          onClick={(event) => {
            if (submitting) {
              event.preventDefault()
              onNotice('Wait for your review to finish submitting before leaving.')
            }
          }}
        >
          <ArrowLeft size={14} />
          Back to inbox
        </Link>
        {groups.length > 0 && (
          <div className="group-navigation-title">
            <span>Groups</span>
            <button
              className="regenerate-icon"
              aria-label="Regenerate groups"
              title="Regenerate groups"
              disabled={organizing}
              onClick={() => {
                onSelect(undefined)
                onRegenerate()
              }}
            >
              <RotateCw size={13} className={organizing ? 'animate-spin' : undefined} />
            </button>
          </div>
        )}
      </div>
      <div className="group-list">
        {updates && (
          <UpdatesGroupRow
            group={updates}
            removed={changes?.removed.length ?? 0}
            viewed={updates.hunkIds.filter((id) => reviewed.has(id)).length}
            done={groupIsViewed(updates, draft, pull)}
            selected={selectedId === updates.id}
            onSelect={() => {
              onSelect(updates.id)
            }}
            onDismiss={onDismissUpdates}
          />
        )}
        {groups.map((group) => {
          const done = groupIsViewed(group, draft, pull)
          const viewed = group.hunkIds.filter((id) => reviewed.has(id)).length
          const updated =
            changes?.sections.filter((section) => group.hunkIds.includes(section.hunkId)).length ??
            0
          const totals = groupChangeTotals(pull, group)
          return (
            <button
              className={`group-row ${selected?.id === group.id ? 'selected' : ''}`}
              data-reviewed={done ? true : undefined}
              key={group.id}
              onClick={() => {
                onSelect(group.id)
              }}
            >
              <div className="group-row-top">
                {done ? (
                  <Check size={13} className="green group-viewed" aria-label="Viewed" />
                ) : (
                  <span className={`priority ${group.priority.toLowerCase()}`}>
                    {group.priority}
                  </span>
                )}
                <strong>{group.title}</strong>
              </div>
              <span className="group-change-stats muted">
                <span>
                  {group.fileIds.length} {group.fileIds.length === 1 ? 'file' : 'files'}
                </span>
                <span className="green">+{totals.additions}</span>
                <span className="red">−{totals.deletions}</span>
              </span>
              <span className="group-progress muted">
                {viewed}/{group.hunkIds.length} sections viewed
                {updated > 0 && <span className="section-update"> · {updated} updated</span>}
              </span>
            </button>
          )
        })}
        {grouped && !groups.length && <p className="empty-small muted">No changes to review.</p>}
      </div>
    </aside>
  )
}

/** Pinned above the regular groups until dismissed; a finished one shrinks to its title. */
function UpdatesGroupRow({
  group,
  removed,
  viewed,
  done,
  selected,
  onSelect,
  onDismiss,
}: {
  group: ChangeGroup
  removed: number
  viewed: number
  done: boolean
  selected: boolean
  onSelect: () => void
  onDismiss?: () => void
}) {
  return (
    <div className="updates-group" data-reviewed={done || undefined}>
      <button className={`group-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="group-row-top">
          {done ? (
            <Check size={13} className="green group-viewed" aria-label="Viewed" />
          ) : (
            <History size={13} className="section-update" aria-hidden="true" />
          )}
          <strong>{group.title}</strong>
        </div>
        {!done && (
          <span className="group-progress muted">
            {viewed}/{group.hunkIds.length} sections viewed
            {removed > 0 && <> · {removed} no longer in PR</>}
          </span>
        )}
      </button>
      {onDismiss && (
        <button
          className="updates-dismiss"
          aria-label="Dismiss review updates"
          title="Dismiss review updates"
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
