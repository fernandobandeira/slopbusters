import { useState } from 'react'
import { DiffSide, type DraftComment, type ReviewThread } from '../shared/types'
import type { LineDiscussion } from './discussions'
import { Button } from './vendor/t3/components/ui/button'
import { message } from './api'

export function ThreadDiscussion({
  thread,
  onReply,
}: {
  thread: ReviewThread
  onReply: (thread: ReviewThread, body: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(() => !thread.resolved && !thread.outdated)
  const [replyOpen, setReplyOpen] = useState(false)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  async function post() {
    if (!body.trim() || posting) return
    setPosting(true)
    setError('')
    try {
      await onReply(thread, body.trim())
      setBody('')
      setReplyOpen(false)
    } catch (error) {
      setError(
        `${message(error)} Check the discussion on GitHub before retrying if the connection was interrupted.`,
      )
    } finally {
      setPosting(false)
    }
  }
  return (
    <details
      className="thread-discussion"
      data-thread-id={thread.id}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="discussion-toggle">
        <span className="discussion-toggle-content">
          <span className="discussion-heading">
            <strong>{thread.comments[0]?.author ?? 'Discussion'}</strong>
            <span className="discussion-comment-count">
              {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}
            </span>
            {thread.resolved && <span className="discussion-status resolved">Resolved</span>}
            {thread.outdated && <span className="discussion-status">Outdated</span>}
          </span>
          <span className="discussion-preview">{thread.comments[0]?.body}</span>
        </span>
      </summary>
      <div className="discussion-heading discussion-link">
        <a className="push-right" href={thread.comments[0]?.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </div>
      {thread.comments.map((comment) => (
        <div className="discussion-comment" key={comment.id}>
          <div className="discussion-author">
            <strong>{comment.author}</strong>
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleDateString()}
            </time>
          </div>
          <p>{comment.body}</p>
        </div>
      ))}
      {thread.canReply && !replyOpen && (
        <Button variant="ghost" size="xs" onClick={() => setReplyOpen(true)}>
          Reply
        </Button>
      )}
      {replyOpen && (
        <form
          className="inline-composer"
          onSubmit={(event) => {
            event.preventDefault()
            void post()
          }}
        >
          <textarea
            aria-label="Reply to discussion"
            autoFocus
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={10000}
            disabled={posting}
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="composer-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={posting}
              onClick={() => setReplyOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!body.trim() || posting}>
              {posting ? 'Posting…' : 'Post reply to GitHub'}
            </Button>
          </div>
        </form>
      )}
    </details>
  )
}

export function DraftDiscussion({
  comment,
  onEdit,
  onDelete,
  submitted = false,
}: {
  comment: DraftComment
  onEdit: (comment: DraftComment) => void
  onDelete: (comment: DraftComment) => void
  submitted?: boolean
}) {
  return (
    <article className="draft-discussion">
      <div className="discussion-heading">
        <strong>Your comment</strong>
        <span className="discussion-status">{submitted ? 'Submitted' : 'Draft'}</span>
      </div>
      <p>{comment.body}</p>
      {!submitted && (
        <div className="composer-actions">
          <Button variant="ghost" size="xs" onClick={() => onEdit(comment)}>
            Edit
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onDelete(comment)}>
            Delete
          </Button>
        </div>
      )}
    </article>
  )
}

export function InlineDiscussion({
  discussion,
  body,
  onBodyChange,
  onSave,
  onCancel,
  onEdit,
  onDelete,
  onReply,
  submitted,
}: {
  discussion: LineDiscussion
  body: string
  onBodyChange: (body: string) => void
  onSave: () => void
  onCancel: () => void
  onEdit: (comment: DraftComment) => void
  onDelete: (comment: DraftComment) => void
  onReply: (thread: ReviewThread, body: string) => Promise<void>
  submitted: boolean
}) {
  return (
    <div
      className="line-discussion"
      data-comment-line={discussion.line}
      data-comment-side={discussion.side}
    >
      {discussion.threads.map((thread) => (
        <ThreadDiscussion thread={thread} onReply={onReply} key={thread.id} />
      ))}
      {discussion.drafts
        .filter((comment) => comment.id !== discussion.editingId)
        .map((comment) => (
          <DraftDiscussion
            key={comment.id}
            comment={comment}
            submitted={submitted}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      {discussion.editingId && (
        <form
          className="inline-composer"
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
          }}
        >
          <div className="discussion-heading">
            <strong>Comment on line {discussion.line}</strong>
            <span className="discussion-status">
              {discussion.side === DiffSide.left ? 'Original' : 'Updated'}
            </span>
          </div>
          <textarea
            aria-label="Line comment"
            autoFocus
            rows={4}
            placeholder="Leave feedback on this line…"
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            maxLength={10000}
          />
          <div className="composer-actions">
            <span className="muted">Local draft · published when you submit your review</span>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!body.trim()}>
              Save draft
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
