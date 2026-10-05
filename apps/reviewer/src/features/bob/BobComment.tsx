import { useState } from 'react'
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
}
export function BobComment({
  pull,
  finding,
  comments,
  onSave,
  onDelete,
  disabled,
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
      <div className="bob-comment">
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
      </div>
    )
  return (
    <form
      className="bob-comment"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(bobDraftComment(pull, finding, body))
        setEditing(false)
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
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            setEditing(false)
          }}
        >
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
