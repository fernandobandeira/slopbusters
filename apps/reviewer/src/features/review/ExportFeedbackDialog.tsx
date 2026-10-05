import type { PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { exportFeedback } from '../../../shared/domain/review'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog'
export function ExportFeedbackDialog({
  open,
  onOpenChange,
  pull,
  draft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pull: PullRequest
  draft: ReviewDraft
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Copy your feedback</DialogTitle>
          <DialogDescription>Select and copy this text into your coding agent.</DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <textarea
            aria-label="Exported feedback"
            rows={14}
            readOnly
            value={exportFeedback(pull, draft)}
            onFocus={(event) => {
              event.target.select()
            }}
          />
        </div>
      </DialogPopup>
    </Dialog>
  )
}
