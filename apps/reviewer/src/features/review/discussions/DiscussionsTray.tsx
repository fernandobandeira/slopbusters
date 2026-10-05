import { X } from 'lucide-react'
import {
  DiffSide,
  type DraftComment,
  type PullRequest,
  type ReviewDraft,
  type ReviewThread,
} from '../../../../shared/domain/types'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { DraftDiscussion, ThreadDiscussion } from './InlineDiscussion'

export function DiscussionsTray({
  pull,
  threads,
  draft,
  onSummaryChange,
  onEdit,
  onDelete,
  submitted = false,
  onClose,
  onOpenLocation,
  onReply,
}: {
  pull: PullRequest
  threads: ReviewThread[]
  draft: ReviewDraft
  onSummaryChange: (summary: string) => void
  onEdit: (comment: DraftComment) => void
  onDelete: (comment: DraftComment) => void
  submitted?: boolean
  onClose: () => void
  onOpenLocation: (location: { path: string; line?: number; side?: DiffSide }) => void
  onReply: (thread: ReviewThread, body: string) => Promise<void>
}) {
  return (
    <aside className="discussion-tray" aria-label="Discussions">
      <div className="discussions-heading">
        <strong>Discussions</strong>
        <Badge variant="secondary">{draft.comments.length + threads.length}</Badge>
        <Button size="icon-xs" variant="ghost" aria-label="Close discussions" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <div className="discussions-list">
        <label className="discussion-summary">
          Review summary
          <textarea
            aria-label="Review summary"
            rows={3}
            value={draft.summary}
            onChange={(event) => {
              onSummaryChange(event.target.value)
            }}
            placeholder="Overall feedback for this review…"
            disabled={submitted}
            maxLength={10000}
          />
        </label>
        {draft.comments.map((comment) => (
          <div className="discussion-entry" key={comment.id}>
            <button
              className="discussion-location"
              onClick={() => {
                onOpenLocation(comment)
              }}
            >
              {comment.path}:{comment.line}
              <span className="muted">
                {' '}
                · {comment.side === DiffSide.left ? 'original' : 'updated'}
              </span>
            </button>
            <DraftDiscussion
              comment={comment}
              onEdit={onEdit}
              onDelete={onDelete}
              submitted={submitted}
            />
          </div>
        ))}
        {threads.map((thread) => (
          <div className="discussion-entry" key={thread.id}>
            {pull.files.some((file) => file.path === thread.path) ? (
              <button
                className="discussion-location"
                onClick={() => {
                  onOpenLocation({
                    path: thread.path,
                    line: thread.outdated ? undefined : (thread.line ?? undefined),
                    side: thread.side,
                  })
                }}
              >
                {thread.path}:{thread.line ?? thread.originalLine ?? 'file'}
              </button>
            ) : (
              <div className="discussion-location">
                {thread.path}:{thread.line ?? thread.originalLine ?? 'file'}
                <span className="muted"> · outside this revision</span>
              </div>
            )}
            <ThreadDiscussion thread={thread} onReply={onReply} />
          </div>
        ))}
        {!threads.length && !draft.comments.length && (
          <div className="empty-small muted">
            No discussions yet. Click a diff line to leave a comment.
          </div>
        )}
      </div>
    </aside>
  )
}
