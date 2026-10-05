import type { PullRequest } from '../../../shared/domain/types'
import { PullDescription } from './PullDescription'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog'
export function DescriptionDialog({
  open,
  onOpenChange,
  pull,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pull: PullRequest
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="description-dialog">
        <DialogHeader>
          <DialogTitle>PR description</DialogTitle>
          <DialogDescription>{pull.title}</DialogDescription>
        </DialogHeader>
        <div className="dialog-body description-body">
          <PullDescription pull={pull} />
        </div>
      </DialogPopup>
    </Dialog>
  )
}
