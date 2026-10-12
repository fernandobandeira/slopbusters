import { useState, type ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { bobCommentId, bobDraftComment, type BobFinding } from '../../../shared/domain/bob'
import type { DraftComment, PullRequest, ReviewDraft } from '../../../shared/domain/types'

interface BobCommentProps {
  pull: PullRequest
  finding: BobFinding
  comments: DraftComment[]
  disabled: boolean
  onSave: (comment: DraftComment) => void
  onDelete: (id: string) => void
  actions?: ReactNode
}
export function BobComment({
  pull,
  finding,
  comments,
  onSave,
  onDelete,
  disabled,
  actions,
}: BobCommentProps) {
  const saved = comments.find((comment) => comment.id === bobCommentId(pull, finding))
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState('')
  function edit() {
    setBody(saved?.body ?? `${finding.title}\n\n${finding.body}\n\n${finding.suggestion}`)
    setEditing(true)
  }
  if (!editing)
    return (
      <div className="bob-actions">
        {saved && (
          <p className="bob-saved" role="status">
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
    <BobCommentForm
      finding={finding}
      body={body}
      setBody={setBody}
      disabled={disabled}
      onSubmit={() => {
        onSave(bobDraftComment(pull, finding, body))
        setEditing(false)
      }}
      onCancel={() => {
        setEditing(false)
      }}
    />
  )
}

function BobCommentForm({
  finding,
  body,
  setBody,
  disabled,
  onSubmit,
  onCancel,
}: {
  finding: BobFinding
  body: string
  setBody: (body: string) => void
  disabled: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <form
      className="bob-comment"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label htmlFor="bob-comment-body">
        Review comment · {finding.path}:{finding.line} ({finding.side})
      </label>
      <textarea
        id="bob-comment-body"
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

export function saveBobComment(draft: ReviewDraft, comment: DraftComment): ReviewDraft {
  return {
    ...draft,
    comments: [...draft.comments.filter((item) => item.id !== comment.id), comment],
  }
}
