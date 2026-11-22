import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import { stackReviewProgress, type StackReviewSession } from '../../../shared/domain/stackReview'
import { stripCounts } from '../../../shared/domain/stackReviewView'
import { Button } from '~/components/ui/button'
import { StackLayerProgress } from './StackLayerProgress'
import { useStackReview } from './useStackReview'
import './stackReview.css'

export type RenderStackStart = (options: {
  label: 'Review the whole stack' | 'Review again'
  disabled: boolean
  busy: boolean
  error: string
  start: (reviewers: PanelSeatRequest[]) => Promise<boolean>
}) => ReactNode

export function StackReview({
  url,
  renderStart,
  openPath,
  onOpen,
}: {
  url: string
  renderStart: RenderStackStart
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
              <StackStart review={review} label="Review again" renderStart={renderStart} />
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
        <ReviewProgress review={review} renderStart={renderStart} />
      )}
    </section>
  )
}

export function ReviewProgress({
  review,
  renderStart,
}: {
  review: ReturnType<typeof useStackReview>
  renderStart: RenderStackStart
}) {
  const { session } = review
  if (session?.status === 'running')
    return <RunningReview key={session.id} session={session} review={review} />
  return (
    <>
      <div className="stack-review-header">
        <p className="stack-review-progress" role="status">
          {session?.progress ??
            (review.loading
              ? 'Loading stack review…'
              : 'Review every layer with the panel, then read them together.')}
        </p>
        <StackReviewAction review={review} renderStart={renderStart} />
      </div>
      <ReviewError review={review} />
    </>
  )
}

function RunningReview({
  session,
  review,
}: {
  session: StackReviewSession
  review: ReturnType<typeof useStackReview>
}) {
  const [showLayers, setShowLayers] = useState(false)
  const { done, total, failed, crossLayer } = stackReviewProgress(session)
  return (
    <>
      <div className="stack-review-header">
        <p className="stack-review-progress" role="status">
          {crossLayer
            ? session.progress
            : `Reviewing the stack · ${String(done)} of ${String(total)} ${total === 1 ? 'layer' : 'layers'} done`}
          {failed > 0 && ` · ${String(failed)} failed`}
        </p>
        <div className="stack-review-actions">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showLayers}
            onClick={() => {
              setShowLayers(!showLayers)
            }}
          >
            {showLayers ? 'Hide layers' : 'Show layers'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={review.busy}
            onClick={() => void review.cancel(session.id)}
          >
            Cancel
          </Button>
        </div>
      </div>
      <ReviewError review={review} />
      {showLayers && <StackLayerProgress session={session} />}
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
  renderStart,
}: {
  review: ReturnType<typeof useStackReview>
  renderStart: RenderStackStart
}) {
  const { session, busy } = review
  if (session && session.status !== 'complete')
    return (
      <div className="stack-review-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void review.retry(session.id)}
        >
          Retry the stack review
        </Button>
        <StackStart review={review} label="Review again" renderStart={renderStart} />
      </div>
    )
  return (
    <StackStart
      review={review}
      label={session ? 'Review again' : 'Review the whole stack'}
      renderStart={renderStart}
    />
  )
}

export function StackStart({
  review,
  label,
  renderStart,
}: {
  review: ReturnType<typeof useStackReview>
  label: Parameters<RenderStackStart>[0]['label']
  renderStart: RenderStackStart
}) {
  return renderStart({
    label,
    disabled: review.busy || review.loading,
    busy: review.busy,
    error: review.startError,
    start: review.start,
  })
}
