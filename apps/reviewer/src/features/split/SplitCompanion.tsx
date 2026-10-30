import { useEffect, type ReactNode } from 'react'
import { ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import type { SplitLayer, SplitSession } from '../../../shared/domain/split'
import type { Mood } from '../../../shared/domain/teammates'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'
import { useSplitSession } from './useSplitSession'
import '../../linus.css'
import './split.css'

/**
 * Linus splitting one PR into a stack: the two models' turns, the layers as built, and the PRs
 * that publish them.
 */
export function SplitCompanion({
  sessionId,
  onClose,
  onSettled,
  renderSessionCard,
}: {
  sessionId: string
  onClose: () => void
  /** The split stopped running, so the PR list may have new PRs. */
  onSettled: () => void
  renderSessionCard?: (sessionId: string) => ReactNode
}) {
  const { session, loading, busy, error, act } = useSplitSession(sessionId, onSettled)
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])
  const mood = splitMood(session)
  return (
    <aside
      className="linus-companion linus-open split-companion"
      aria-label="Linus split companion"
    >
      <div className="linus-bubble">
        <header>
          <span className="linus-eyebrow">
            LINUS · SPLITTING{session ? ` PR #${String(session.number)}` : ''}
          </span>
          <button className="linus-icon-button" aria-label="Close the split" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {renderSessionCard?.(sessionId)}
        {session && <SplitProgress session={session} busy={busy} act={act} />}
        {loading && !session && (
          <p className="muted" role="status">
            Loading the split…
          </p>
        )}
        {error && (
          <p className="linus-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="linus-portrait" aria-label="Minimize the split" onClick={onClose}>
        <ReviewerFace
          name="Linus"
          src={personaFaceSrc('linus', mood)}
          size={112}
          label={`Linus, ${mood}`}
        />
      </button>
    </aside>
  )
}

function SplitProgress({
  session,
  busy,
  act,
}: {
  session: SplitSession
  busy: boolean
  act: (action: 'cancel' | 'retry') => Promise<void>
}) {
  const active = session.status === 'running'
  const latest = session.turns.at(-1)
  return (
    <>
      <p className="linus-speech split-progress" role="status">
        {active && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
        {session.status === 'complete' && <Check size={15} aria-hidden="true" />}
        {session.progress}
      </p>
      {latest && active && (
        <p className="muted linus-small">
          {latest.role === 'primary' ? 'Primary' : 'Secondary'} · turn {latest.round}:{' '}
          {latest.summary}
        </p>
      )}
      {session.error && (
        <p className="linus-error" role="alert">
          {session.error}
        </p>
      )}
      {session.layers.length > 0 && <SplitLayers session={session} />}
      <SplitTurns turns={session.turns} />
      <div className="linus-actions split-actions">
        {active ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('cancel')}>
            Cancel the split
          </Button>
        ) : (
          session.status !== 'complete' && (
            <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
              Retry the split
            </Button>
          )
        )}
      </div>
    </>
  )
}

/** The stack bottom to top: each layer's PR once opened, else its branch, with its size. */
function SplitLayers({ session }: { session: SplitSession }) {
  return (
    <ol className="split-layers" aria-label="Layers">
      {session.layers.map((layer, index) => (
        <li key={layer.branch}>
          <strong>
            {index + 1}. <LayerLink layer={layer} />
          </strong>
          <span className="muted">
            {' '}
            · +{layer.additions} −{layer.deletions}
            {layer.pullUrl ? '' : ` · ${layer.branch}`}
          </span>
        </li>
      ))}
      {session.verified && (
        <li className="muted split-verified">
          <Check size={12} aria-hidden="true" /> The stack adds up to PR #{session.number} exactly.
        </li>
      )}
    </ol>
  )
}

function LayerLink({ layer }: { layer: SplitLayer }) {
  if (!layer.pullUrl) return <>{layer.title}</>
  return (
    <a href={layer.pullUrl} target="_blank" rel="noreferrer">
      #{layer.pullNumber} {layer.title}
      <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  )
}

function SplitTurns({ turns }: { turns: SplitSession['turns'] }) {
  if (!turns.length) return null
  return (
    <details className="finding-notes split-turns">
      <summary>Cutting and review turns · {turns.length}</summary>
      <ul>
        {turns.map((turn) => (
          <li key={`${turn.role}-${String(turn.round)}`}>
            <strong>
              {turn.role === 'primary' ? 'Primary' : 'Secondary'} · turn {turn.round}
              {turn.approved ? ' · Approved' : turn.changed ? ' · Re-cut' : ''}
            </strong>
            <p>{turn.summary}</p>
            {turn.issues.map((issue, index) => (
              <p key={index} className="muted">
                {issue}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}

function splitMood(session?: SplitSession): Mood {
  if (!session || session.status === 'running') return 'thinking'
  if (session.status === 'complete') return 'happy'
  return session.status === 'failed' ? 'angry' : 'resigned'
}
