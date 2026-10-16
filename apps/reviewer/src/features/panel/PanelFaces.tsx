import type { PanelReviewer } from '../../../shared/domain/panel'
import type { Mood, Teammate } from '../../../shared/domain/teammates'
import { ReviewerFace } from '../../components/ReviewerFace'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'

/** The faces of the reviewers who raised something, named for screen readers. */
export function PanelFaces({
  ids,
  reviewers,
  teammates,
  mood = 'neutral',
  size = 22,
}: {
  ids: readonly string[]
  reviewers: readonly PanelReviewer[]
  teammates?: readonly Teammate[]
  mood?: Mood
  size?: number
}) {
  const names = ids.map((id) => reviewerName(reviewers, id))
  return (
    <span className="panel-faces" role="img" aria-label={`Raised by ${names.join(', ')}`}>
      {ids.map((id, index) => (
        <ReviewerFace
          key={id}
          name={names[index] ?? id}
          src={reviewerFaceSrc(id, mood, teammates)}
          size={size}
        />
      ))}
      <span className="panel-faces-names" aria-hidden="true">
        {names.join(', ')}
      </span>
    </span>
  )
}

export function reviewerName(reviewers: readonly PanelReviewer[], id: string): string {
  return reviewers.find((reviewer) => reviewer.id === id)?.name ?? id
}
