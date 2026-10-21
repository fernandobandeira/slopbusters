import { useId, useState, type ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import type { DraftComment, ReviewDraft } from '../../shared/domain/types'

interface FindingCommentProps {
  /** The stable id the finding's draft comment is saved under. */
  commentId: string
  /** Names where the comment lands, such as `src/a.ts:12 (RIGHT)`. */
  location: string
  /** What the editor starts with when there is no saved comment yet. */
  initialBody: string
  toComment: (body: string) => DraftComment
  comments: DraftComment[]
  disabled: boolean
  onSave: (comment: DraftComment) => void
  onDelete: (id: string) => void
  actions?: ReactNode
}

/** Turns a reviewer's finding into an editable comment in the user's review draft. */
export function FindingComment({
  commentId,
  comments,
  onSave,
  onDelete,
  toComment,
  ...entry
}: FindingCommentProps) {
  const saved = comments.find((comment) => comment.id === commentId)
  return (
    <FindingDraftEntry
      {...entry}
      saved={saved?.body}
      labels={commentLabels}
      onSave={(body) => {
        onSave(toComment(body))
      }}
      onRemove={() => {
        onDelete(commentId)
      }}
    />
  )
}

/**
 * Turns a finding that has no line to sit on, such as one about the PR description, into a
 * passage of the review draft's summary, saved under the finding's id so it can be edited.
 */
export function FindingSummaryEntry({
  entryId,
  draft,
  setDraft,
  ...entry
}: Omit<FindingCommentProps, 'commentId' | 'comments' | 'onSave' | 'onDelete' | 'toComment'> & {
  entryId: string
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
}) {
  return (
    <FindingDraftEntry
      {...entry}
      saved={summaryEntry(draft, entryId)}
      labels={summaryLabels}
      onSave={(body) => {
        setDraft((previous) => saveSummaryEntry(previous, entryId, body))
      }}
      onRemove={() => {
        setDraft((previous) => removeSummaryEntry(previous, entryId))
      }}
    />
  )
}

const commentLabels = {
  saved: 'Comment saved in your review draft',
  add: 'Add review comment',
  edit: 'Edit draft comment',
  remove: 'Remove comment',
  form: 'Review comment',
}
const summaryLabels = {
  saved: 'Saved in your review summary',
  add: 'Add to review summary',
  edit: 'Edit in review summary',
  remove: 'Remove from summary',
  form: 'Review summary',
}

function FindingDraftEntry({
  saved,
  labels,
  initialBody,
  location,
  disabled,
  actions,
  onSave,
  onRemove,
}: {
  saved?: string
  labels: typeof commentLabels
  initialBody: string
  location: string
  disabled: boolean
  actions?: ReactNode
  onSave: (body: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState('')
  function edit() {
    setBody(saved ?? initialBody)
    setEditing(true)
  }
  if (!editing)
    return (
      <div className="finding-actions">
        {saved !== undefined && (
          <p className="finding-saved" role="status">
            {labels.saved}
          </p>
        )}
        <Button size="sm" variant="outline" disabled={disabled} onClick={edit}>
          {saved === undefined ? labels.add : labels.edit}
        </Button>
        {saved !== undefined && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
            {labels.remove}
          </Button>
        )}
        {actions}
      </div>
    )
  return (
    <FindingCommentForm
      label={`${labels.form} · ${location}`}
      body={body}
      setBody={setBody}
      disabled={disabled}
      onSubmit={() => {
        onSave(body)
        setEditing(false)
      }}
      onCancel={() => {
        setEditing(false)
      }}
    />
  )
}

function FindingCommentForm({
  label,
  body,
  setBody,
  disabled,
  onSubmit,
  onCancel,
}: {
  label: string
  body: string
  setBody: (body: string) => void
  disabled: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  const id = useId()
  return (
    <form
      className="finding-comment"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={5}
        maxLength={10000}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        autoFocus
      />
      <div className="linus-actions">
        <Button size="sm" type="submit" disabled={disabled || !body.trim()}>
          Save to review draft
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Save a comment into the draft, replacing an earlier one with the same id. */
export function saveDraftComment(draft: ReviewDraft, comment: DraftComment): ReviewDraft {
  return {
    ...draft,
    comments: [...draft.comments.filter((item) => item.id !== comment.id), comment],
  }
}

export function removeDraftComment(draft: ReviewDraft, id: string): ReviewDraft {
  return { ...draft, comments: draft.comments.filter((comment) => comment.id !== id) }
}

/** The passage saved in the summary under `id`, between markers GitHub does not render. */
function summaryEntry(draft: ReviewDraft, id: string): string | undefined {
  return summaryEntryPattern(id).exec(draft.summary)?.[1]
}

/** Save a passage into the summary, replacing an earlier one with the same id. */
function saveSummaryEntry(draft: ReviewDraft, id: string, body: string): ReviewDraft {
  const entry = `<!-- ${id} -->\n${body.trim()}\n<!-- /${id} -->`
  const rest = removeSummaryEntry(draft, id).summary.trimEnd()
  return { ...draft, summary: rest ? `${rest}\n\n${entry}` : entry }
}

function removeSummaryEntry(draft: ReviewDraft, id: string): ReviewDraft {
  const summary = draft.summary.replace(summaryEntryPattern(id), '').replace(/\n{3,}/g, '\n\n')
  return { ...draft, summary: summary.trim() }
}

function summaryEntryPattern(id: string) {
  const marker = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\n*<!-- ${marker} -->\\n([\\s\\S]*?)\\n<!-- /${marker} -->`)
}
