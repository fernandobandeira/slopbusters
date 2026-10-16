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
  initialBody,
  comments,
  onSave,
  onDelete,
  disabled,
  actions,
  location,
  toComment,
}: FindingCommentProps) {
  const saved = comments.find((comment) => comment.id === commentId)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState('')
  function edit() {
    setBody(saved?.body ?? initialBody)
    setEditing(true)
  }
  if (!editing)
    return (
      <div className="finding-actions">
        {saved && (
          <p className="finding-saved" role="status">
            Comment saved in your review draft
          </p>
        )}
        <Button size="sm" variant="outline" disabled={disabled} onClick={edit}>
          {saved ? 'Edit draft comment' : 'Add review comment'}
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onDelete(saved.id)
            }}
          >
            Remove comment
          </Button>
        )}
        {actions}
      </div>
    )
  return (
    <FindingCommentForm
      location={location}
      body={body}
      setBody={setBody}
      disabled={disabled}
      onSubmit={() => {
        onSave(toComment(body))
        setEditing(false)
      }}
      onCancel={() => {
        setEditing(false)
      }}
    />
  )
}

function FindingCommentForm({
  location,
  body,
  setBody,
  disabled,
  onSubmit,
  onCancel,
}: {
  location: string
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
      <label htmlFor={id}>Review comment · {location}</label>
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
