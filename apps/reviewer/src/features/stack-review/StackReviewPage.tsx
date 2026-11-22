import type { StackRecordActions } from './useStackRecords'
import { useState } from 'react'
import { Link } from 'react-router'
import type { PanelSeatRequest } from '../../../shared/domain/panel'
import type { StackBrief } from '../../../shared/domain/stackBrief'
import { layerMoved, type BriefLayer } from '../../../shared/domain/stackBriefLayers'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import {
  briefCounts,
  briefOnLayer,
  coverageWarnings,
  reviewLead,
} from '../../../shared/domain/stackReviewView'
import { CopyButton } from '../../components/CopyButton'
import { Button } from '~/components/ui/button'
import { StackBriefView } from './StackBriefView'
import { ReviewProgress } from './StackReview'
import { useStackReview } from './useStackReview'

export function StackReviewPage({
  url,
  reviewers,
  backPath,
}: {
  url: string
  reviewers: PanelSeatRequest[]
  backPath: string
}) {
  const review = useStackReview(url)
  const { brief, session } = review
  return (
    <div className="stack-review-page">
      <header className="stack-review-actions stack-review-page-tools">
        <Button size="sm" variant="ghost" render={<Link to={backPath} />}>
          Back to pull request
        </Button>
        {brief && session && (
          <>
            <CopyButton
              label="Copy full brief"
              text={stackBriefMarkdown(brief, session.repository)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={review.busy}
              onClick={() => void review.start(reviewers)}
            >
              Review again
            </Button>
          </>
        )}
      </header>
      {brief && session ? (
        <CompletedReview
          key={session.id}
          brief={brief}
          sessionId={session.id}
          actions={review.records}
          error={review.error}
        />
      ) : (
        <ReviewProgress review={review} reviewers={reviewers} />
      )}
    </div>
  )
}

function CompletedReview({
  brief,
  sessionId,
  actions,
  error,
}: {
  brief: StackBrief
  sessionId: string
  actions: StackRecordActions
  error?: string
}) {
  const [layer, setLayer] = useState<number>()
  const visible = briefOnLayer(brief, layer)
  const warnings = coverageWarnings(brief)
  return (
    <div className="stack-review-layout">
      <nav className="stack-review-rail" aria-label="Filter review by layer">
        <RailRow
          brief={brief}
          active={layer === undefined}
          onSelect={() => {
            setLayer(undefined)
          }}
        />
        {[...brief.layers].reverse().map((item) => (
          <RailRow
            key={item.number}
            layer={item}
            brief={briefOnLayer(brief, item.number)}
            active={layer === item.number}
            onSelect={() => {
              setLayer(item.number)
            }}
          />
        ))}
      </nav>
      <div className="stack-review-content">
        <p className="stack-review-lead">{reviewLead(visible)}</p>
        {warnings.length > 0 && (
          <p className="stack-warning stack-review-coverage">{warnings.join(' ')}</p>
        )}
        {error && (
          <p className="stack-warning" role="alert">
            {error}
          </p>
        )}
        <StackBriefView
          brief={visible}
          fixGroups={brief.fixes}
          sessionId={sessionId}
          actions={actions}
        />
      </div>
    </div>
  )
}

function RailRow({
  brief,
  layer,
  active,
  onSelect,
}: {
  brief: StackBrief
  layer?: BriefLayer
  active: boolean
  onSelect: () => void
}) {
  const { fixes, total, answered } = briefCounts(brief)
  const moved = layer && layerMoved(layer)
  return (
    <Button
      className="stack-review-rail-row"
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="stack-review-rail-title" title={layer?.title}>
        {layer ? (
          <>
            <span className="stack-brief-detail">#{layer.number}</span> {layer.title}
          </>
        ) : (
          'Whole stack'
        )}
      </span>
      <span className="stack-review-rail-counts">
        {moved && (
          <span
            className="stack-warning"
            title={`Reviewed head ${layer.reviewedHead ?? 'unknown'} · Reviewed base ${layer.reviewedBase ?? 'unknown'}`}
          >
            Moved
          </span>
        )}
        {total > 0 && (
          <span title={`${answered} of ${total} answered`}>
            {answered}/{total}
          </span>
        )}
        <span title={`${fixes} fixes`}>
          {fixes}
          <span className="sr-only"> fixes</span>
        </span>
      </span>
    </Button>
  )
}
