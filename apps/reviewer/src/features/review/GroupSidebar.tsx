import { Link } from 'react-router'
import { ArrowLeft, Check, History, RotateCw, X } from 'lucide-react'
import type { ChangeGroup, PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { groupChangeTotals } from '../../../shared/domain/review'
import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import { groupIsViewed } from './reviewProgress'
import { questionReadCount, questionSections, sectionLineCount } from './questionSections'
import './reviewQuestions.css'

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
  const keyChanges = groups.filter((group) => group.claim)
  const plain = groups.filter((group) => !group.claim && !group.lane)
  const setAside = groups.filter((group) => !group.claim && group.lane)
  function row(group: ChangeGroup) {
    return (
      <GroupRow
        key={group.id}
        group={group}
        pull={pull}
        done={groupIsViewed(group, draft, pull)}
        selected={selectedId === group.id}
        updated={
          changes?.sections.filter((section) => group.hunkIds.includes(section.hunkId)).length ?? 0
        }
        onSelect={() => {
          onSelect(group.id)
        }}
      />
    )
  }
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
            <span>{keyChanges.length ? 'Key changes' : 'Groups'}</span>
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
      {keyChanges.length > 0 && (
        <p className="review-read-count muted">{questionReadCount(pull, keyChanges)}</p>
      )}
      <div className="group-list">
        {updates && (
          <UpdatesGroupRow
            group={updates}
            removed={changes?.removed.length ?? 0}
            totals={groupChangeTotals(pull, updates)}
            done={groupIsViewed(updates, draft, pull)}
            selected={selectedId === updates.id}
            onSelect={() => {
              onSelect(updates.id)
            }}
            onDismiss={onDismissUpdates}
          />
        )}
        {keyChanges.map(row)}
        {plain.map(row)}
        {setAside.length > 0 && (
          <section aria-labelledby="set-aside-groups">
            <h2 id="set-aside-groups" className="set-aside-heading muted">
              Set aside
            </h2>
            {setAside.map(row)}
          </section>
        )}
        {grouped && !groups.length && <p className="empty-small muted">No changes to review.</p>}
      </div>
    </aside>
  )
}

function GroupRow({
  group,
  pull,
  done,
  selected,
  updated,
  onSelect,
}: {
  group: ChangeGroup
  pull: PullRequest
  done: boolean
  selected: boolean
  updated: number
  onSelect: () => void
}) {
  const sections = group.claim ? questionSections(group) : undefined
  const totals = groupChangeTotals(pull, sections ? { ...group, hunkIds: sections.key } : group)
  return (
    <button
      className={`group-row ${selected ? 'selected' : ''}`}
      data-reviewed={done ? true : undefined}
      data-lane={group.lane}
      data-key-change={sections ? true : undefined}
      onClick={onSelect}
    >
      <div className="group-row-top">
        {done && <Check size={13} className="green group-viewed" aria-label="Viewed" />}
        {!group.lane && (!done || sections) && (
          <span className={`priority ${group.priority.toLowerCase()}`}>{group.priority}</span>
        )}
        <strong>{group.title}</strong>
      </div>
      {group.lane && <span className="group-lane muted">{group.lane}</span>}
      <span className="group-change-stats muted">
        <span>
          {group.fileIds.length} {group.fileIds.length === 1 ? 'file' : 'files'}
        </span>
        <span className="green">+{totals.additions}</span>
        <span className="red">−{totals.deletions}</span>
        {updated > 0 && <span className="section-update">{updated} updated</span>}
      </span>
      {sections && <QuestionRowDetails pull={pull} group={group} sections={sections} />}
    </button>
  )
}

function QuestionRowDetails({
  pull,
  group,
  sections,
}: {
  pull: PullRequest
  group: ChangeGroup
  sections: ReturnType<typeof questionSections>
}) {
  return (
    <span className="question-row-details muted">
      {sections.supporting.length > 0 && (
        <span>
          {sectionLineCount(pull, group, sections.supporting).toLocaleString()} supporting
        </span>
      )}
      {sections.test.length > 0 ? (
        <span>{sectionLineCount(pull, group, sections.test).toLocaleString()} test</span>
      ) : (
        <span className="no-test-marker">No test</span>
      )}
    </span>
  )
}

/** Pinned above the regular groups until dismissed; a finished one shrinks to its title. */
function UpdatesGroupRow({
  group,
  removed,
  totals,
  done,
  selected,
  onSelect,
  onDismiss,
}: {
  group: ChangeGroup
  removed: number
  totals: { additions: number; deletions: number }
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
          <span className="group-change-stats muted">
            <span className="green">+{totals.additions}</span>
            <span className="red">−{totals.deletions}</span>
            {removed > 0 && <span>{removed} no longer in PR</span>}
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
