import { Layers } from 'lucide-react'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { layerProgress, type StackReviewSession } from '../../../shared/domain/stackReview'
import { Button } from '~/components/ui/button'
import { StackBriefView } from './StackBriefView'
import { useStackReview } from './useStackReview'
import './stackReview.css'

/**
 * Review the whole stack a PR belongs to with the reviewers last picked: each layer's progress
 * while the panels work, then the stack brief.
 */
export function StackReview({ url, reviewers }: { url: string; reviewers: PanelSeatRequest[] }) {
  const review = useStackReview(url)
  const { session } = review
  const brief = session?.status === 'complete' ? stackBrief(session) : undefined
  return (
    <section className="stack-review" aria-label="Stack review">
      <div className="stack-review-header">
        <p className="stack-review-progress" role="status">
          {session
            ? session.progress
            : 'Review every layer with the panel, then read them together.'}
        </p>
        <StackReviewAction review={review} reviewers={reviewers} />
      </div>
      {review.error && (
        <p className="stack-warning" role="alert">
          {review.error}
        </p>
      )}
      {session && !brief && <LayerProgress session={session} />}
      {session && brief && <StackBriefView brief={brief} repository={session.repository} />}
    </section>
  )
}

function StackReviewAction({
  review,
  reviewers,
}: {
  review: ReturnType<typeof useStackReview>
  reviewers: PanelSeatRequest[]
}) {
  const { session, busy } = review
  if (session?.status === 'running')
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => void review.cancel(session.id)}
      >
        Cancel
      </Button>
    )
  if (session && session.status !== 'complete')
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void review.retry(session.id)}
      >
        Retry the stack review
      </Button>
    )
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || review.loading}
      onClick={() => void review.start(reviewers)}
    >
      <Layers size={13} aria-hidden="true" />
      Review the whole stack
    </Button>
  )
}

function LayerProgress({ session }: { session: StackReviewSession }) {
  return (
    <ol className="stack-review-layers" aria-label="Layers, bottom to top">
      {session.layers.map((layer) => (
        <li key={layer.url} className={`stack-review-layer stack-review-${layer.state}`}>
          <span className="stack-pr-number">#{layer.number}</span> {layer.title}
          <span className="stack-review-note">{layerProgress(layer)}</span>
        </li>
      ))}
    </ol>
  )
}
