import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { X } from 'lucide-react'
import type { InboxPull } from '../../../shared/domain/types'
import { useGandalfSession } from './useGandalfSession'
import { GandalfSelection } from './GandalfSelection'
import { GandalfProgress } from './GandalfProgress'
import './gandalf.css'

interface GandalfProps {
  repository: string
  pulls: InboxPull[]
  ready: boolean
  onClose: () => void
  onComplete: () => void
}

export function GandalfCompanion({ repository, pulls, ready, onClose, onComplete }: GandalfProps) {
  const { session, busy, loading, error, act, reload } = useGandalfSession(repository, onComplete)
  const [selected, setSelected] = useState<string[]>([])
  const [choosing, setChoosing] = useState(true)
  const active = session?.status === 'running'
  const selection = selected.filter((url) => pulls.some((pull) => pull.url === url))
  const showingProgress = session && (active || !choosing)
  const emotion = active
    ? 'thinking'
    : showingProgress
      ? session.status === 'complete'
        ? 'happy'
        : 'angry'
      : 'neutral'
  useCloseOnEscape(onClose)
  return (
    <aside className="gandalf-companion" aria-label="Gandalf conflict companion">
      <div className="gandalf-bubble">
        <GandalfHeader onClose={onClose} />
        {session && choosing && !active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChoosing(false)
            }}
          >
            View last resolution
          </Button>
        )}
        {error && (
          <p role="alert">
            {error} <button onClick={reload}>Retry loading</button>
          </p>
        )}
        {showingProgress ? (
          <GandalfProgress
            session={session}
            busy={busy}
            onCancel={() => void act('cancel')}
            onRetry={() => void act('retry')}
            onChoose={() => {
              setSelected([])
              setChoosing(true)
            }}
          />
        ) : (
          <GandalfSelection
            pulls={pulls}
            selected={selection}
            onChange={setSelected}
            ready={ready}
            disabled={busy || loading}
            onStart={() => {
              void act('start', selection).then((started) => {
                if (started) setChoosing(false)
              })
            }}
          />
        )}
      </div>
      <img
        className="gandalf-portrait"
        src={`/gandalf/${emotion}.png`}
        alt={`Gandalf, ${emotion}`}
      />
    </aside>
  )
}

function GandalfHeader({ onClose }: { onClose: () => void }) {
  return (
    <header>
      <span>GANDALF · CONFLICT RESOLUTION</span>
      <button aria-label="Close Gandalf" onClick={onClose}>
        <X size={16} />
      </button>
    </header>
  )
}

function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])
}
