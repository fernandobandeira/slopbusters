import type { PullStatus } from '../../../shared/domain/pullStatus'
import { usePullStatus } from './usePullStatus'
import { PullStatusPanel } from './PullStatusPanel'
import type { PullStatusSection } from './PullStatusIcons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '~/components/ui/dialog'

interface Props {
  url: string | undefined
  onClose: () => void
  status?: PullStatus
  error?: string
  snapshotHeadSha?: string
  section?: PullStatusSection
}

export function PullStatusDialog({
  url,
  onClose,
  status: supplied,
  error: suppliedError,
  snapshotHeadSha,
  section,
}: Props) {
  const remote = usePullStatus(supplied ? undefined : url)
  const status = supplied ?? remote.status
  const error = suppliedError ?? remote.error
  return (
    <Dialog
      open={Boolean(url)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPopup className="pull-status-dialog">
        <DialogHeader>
          <DialogTitle>
            {section === 'conflicts'
              ? 'Merge conflicts'
              : section === 'checks'
                ? 'CI checks'
                : section === 'comments'
                  ? 'Unresolved discussions'
                  : section === 'reviews' || section === 'changes'
                    ? 'Reviews'
                    : 'Checks and reviews'}
          </DialogTitle>
          <DialogDescription>
            GitHub merge requirements, CI results, and reviewers for the latest PR revision.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          {!status && !error && (
            <p role="status" className="muted">
              Loading GitHub status…
            </p>
          )}
          {error && (
            <div role="alert" className="pull-status-error">
              <p>
                {status ? 'Could not refresh GitHub status. Showing the last result. ' : ''}
                {error}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.dispatchEvent(new Event('online'))}
              >
                Try again
              </Button>
            </div>
          )}
          {status && snapshotHeadSha && status.headSha !== snapshotHeadSha && (
            <p className="pull-status-warning" role="status">
              These checks belong to a newer PR revision. Reload the diff to review that revision.
            </p>
          )}
          {status && <PullStatusPanel status={status} section={section} pullUrl={url} />}
        </div>
      </DialogPopup>
    </Dialog>
  )
}
