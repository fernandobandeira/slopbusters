import { Button } from '~/components/ui/button'
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from '~/components/ui/dialog'
import { ReviewEvent, type PullRequest, type ReviewDraft } from '../../../shared/domain/types'
interface Props {
  open: boolean
  pull: PullRequest
  draft: ReviewDraft
  event: ReviewEvent
  submitting: boolean
  submitted?: string
  error: string
  onOpenChange: (open: boolean) => void
  onEventChange: (event: ReviewEvent) => void
  onSummaryChange: (summary: string) => void
  onSubmit: () => void
}
const eventLabels: Record<ReviewEvent, string> = {
  COMMENT: 'Comment',
  REQUEST_CHANGES: 'Request changes',
  APPROVE: 'Approve',
}

export function SubmitReviewDialog({
  open,
  pull,
  draft,
  event,
  submitting,
  submitted,
  error,
  onOpenChange,
  onEventChange,
  onSummaryChange,
  onSubmit,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!submitting) onOpenChange(open)
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Submit to GitHub</DialogTitle>
          <DialogDescription>
            {pull.owner}/{pull.repo} #{pull.number} · commit {pull.headSha.slice(0, 7)}
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <label>
            Review summary
            <textarea
              aria-label="Submission summary"
              rows={3}
              value={draft.summary}
              onChange={(event) => {
                onSummaryChange(event.target.value)
              }}
              placeholder="Optional summary…"
              maxLength={30000}
            />
          </label>
          <div className="review-events">
            {Object.values(ReviewEvent).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="review-event"
                  checked={event === value}
                  onChange={() => {
                    onEventChange(value)
                  }}
                />
                {eventLabels[value]}
              </label>
            ))}
          </div>
          <p className="muted">
            {draft.comments.length} comments will be published as one review under your GitHub
            account.
          </p>
          <div className="submit-preview">
            {draft.comments.map((comment) => (
              <article key={comment.id}>
                <strong>
                  {comment.path
                    ? `${comment.path}:${comment.line} (${comment.side})`
                    : 'Review note'}
                </strong>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              disabled={
                submitting ||
                Boolean(submitted) ||
                (!draft.summary.trim() && !draft.comments.length && event !== ReviewEvent.approve)
              }
              onClick={onSubmit}
            >
              {submitting ? 'Submitting…' : `Submit ${eventLabels[event].toLowerCase()}`}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
