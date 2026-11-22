import { Layers } from 'lucide-react'
import { Link } from 'react-router'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import { layerProgress, type StackReviewSession } from '../../../shared/domain/stackReview'
import { stripCounts } from '../../../shared/domain/stackReviewView'
import { Button } from '~/components/ui/button'
import { useStackReview } from './useStackReview'
import './stackReview.css'

export function StackReview({
  url,
  reviewers,
  openPath,
  onOpen,
}: {
  url: string
  reviewers: PanelSeatRequest[]
  openPath: string
  onOpen: () => void
}) {
  const review = useStackReview(url)
  const counts = review.brief && stripCounts(review.brief)
  return (
    <section className="stack-review" aria-label="Stack review">
      {review.brief ? (
        <>
          <div className="stack-review-header">
            <p className="stack-review-progress" role="status">
              <strong>Review complete</strong>
              {counts && ` · ${counts}`}
            </p>
            <div className="stack-review-actions">
              <Button
                size="sm"
                variant="ghost"
                disabled={review.busy}
                onClick={() => void review.start(reviewers)}
              >
                Review again
              </Button>
              <Button
                className="stack-review-open"
                size="sm"
                render={<Link to={openPath} onClick={onOpen} />}
              >
                Open review
              </Button>
            </div>
          </div>
          <ReviewError review={review} />
        </>
      ) : (
        <ReviewProgress review={review} reviewers={reviewers} />
      )}
    </section>
  )
}

export function ReviewProgress({
  review,
  reviewers,
}: {
  review: ReturnType<typeof useStackReview>
  reviewers: PanelSeatRequest[]
}) {
  const { session } = review
  return (
    <>
      <div className="stack-review-header">
        <p className="stack-review-progress" role="status">
          {session?.progress ??
            (review.loading
              ? 'Loading stack review…'
              : 'Review every layer with the panel, then read them together.')}
        </p>
        <StackReviewAction review={review} reviewers={reviewers} />
      </div>
      <ReviewError review={review} />
      {session?.status === 'running' && <LayerProgress session={session} />}
    </>
  )
}

function ReviewError({ review }: { review: ReturnType<typeof useStackReview> }) {
  const error = review.error || review.session?.error
  return (
    error && (
      <p className="stack-warning" role="alert">
        {error}
      </p>
    )
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
      {session ? 'Review again' : 'Review the whole stack'}
    </Button>
  )
}

function LayerProgress({ session }: { session: StackReviewSession }) {
  return (
    <ol className="stack-review-layers" aria-label="Layers, bottom to top">
      {session.layers.map((layer) => (
        <li key={layer.url} className={`stack-review-layer stack-review-${layer.state}`}>
          <span className="stack-pr-number">#{layer.number}</span> {layer.title}
          <span className="stack-brief-detail">{layerProgress(layer)}</span>
        </li>
      ))}
    </ol>
  )
}
