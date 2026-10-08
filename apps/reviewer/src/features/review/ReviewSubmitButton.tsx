import { Button } from '~/components/ui/button'
import type { PullRequest } from '../../../shared/domain/types'
import { useMarkPullReady } from './useMarkPullReady'

interface Props {
  pull: PullRequest
  isDraft: boolean
  submitting: boolean
  submitted?: string
  onSubmit: () => void
  onReady: (pull: PullRequest) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export function ReviewSubmitButton({
  pull,
  isDraft,
  submitting,
  submitted,
  onSubmit,
  ...options
}: Props) {
  const { markingReady, markReady } = useMarkPullReady(pull, options)
  if (isDraft)
    return (
      <Button
        size="sm"
        disabled={markingReady || submitting || pull.state !== 'open'}
        onClick={() => void markReady()}
      >
        {markingReady ? 'Marking ready…' : 'Mark ready for review'}
      </Button>
    )
  return (
    <Button size="sm" disabled={submitting || Boolean(submitted)} onClick={onSubmit}>
      {submitted ? 'Submitted' : 'Submit review'}
    </Button>
  )
}
