import { seatReviewer, type PanelReviewer } from '../../../shared/domain/panel'
import type { PanelSession } from '../../../shared/domain/panelSession'
import type { Mood, Teammate } from '../../../shared/domain/teammates'
import { ReviewerFace } from '../../components/ReviewerFace'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'

const MAX_FACES = 4

interface StackedFace {
  id: string
  name: string
  mood: Mood
  working: boolean
}

/**
 * Everyone on the panel at once, overlapping: while it runs, each face shows its reviewer's
 * state; on the summary, they all share the verdict's mood. A reviewer running on both providers
 * appears once. `compact` fits the stack inside a button.
 */
export function PanelStack({
  session,
  mood,
  teammates,
  compact = false,
}: {
  session: PanelSession
  mood: Mood
  teammates?: Teammate[]
  compact?: boolean
}) {
  const faces = stackedFaces(session, mood)
  const shown = faces.slice(0, MAX_FACES)
  const hidden = faces.length - shown.length
  return (
    <span
      className={`panel-stack${compact ? ' panel-stack-compact' : ''}`}
      role="img"
      aria-label={stackLabel(faces, session)}
    >
      {shown.map((face, index) => (
        <span
          key={face.id}
          className={`panel-stack-face${face.working ? ' panel-stack-working' : ''}`}
          style={{ zIndex: shown.length - index, animationDelay: `${String(index * 180)}ms` }}
        >
          <ReviewerFace
            name={face.name}
            src={reviewerFaceSrc(face.id, face.mood, teammates)}
            size={compact ? 18 : 64}
          />
        </span>
      ))}
      {hidden > 0 && <span className="panel-stack-more">+{hidden}</span>}
    </span>
  )
}

function stackedFaces(session: PanelSession, mood: Mood): StackedFace[] {
  const running = session.status === 'running' || session.status === 'partial'
  const reviews = session.pending?.reviews ?? []
  const byReviewer = new Map<string, PanelReviewer[]>()
  for (const seat of session.reviewers) {
    const id = seatReviewer(seat.id)
    byReviewer.set(id, [...(byReviewer.get(id) ?? []), seat])
  }
  return [...byReviewer].map(([id, seats]) => {
    const states = seats.map((seat) => reviews.find((review) => review.reviewer === seat.id))
    const failed = states.some((review) => review && !review.advice)
    const working = session.status === 'running' && states.some((review) => !review)
    return {
      id,
      name: (seats[0]?.name ?? id).replace(/ \((?:Claude|Codex)\)$/, ''),
      mood: !running ? mood : failed ? 'resigned' : working ? 'thinking' : 'neutral',
      working,
    }
  })
}

function stackLabel(faces: StackedFace[], session: PanelSession) {
  const names = faces.map((face) => face.name)
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}` : names.join('')
  return session.status === 'running' ? `${list}, reviewing` : list
}
