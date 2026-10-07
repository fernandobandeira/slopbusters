import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import { X } from 'lucide-react'
import type { InboxPull } from '../../../shared/domain/types'
import type { GandalfSession, GandalfTask } from '../../../shared/domain/gandalf'
import { useGandalfSession } from './useGandalfSession'
import { GandalfSelection } from './GandalfSelection'
import { GandalfProgress } from './GandalfProgress'
import './gandalf.css'

interface GandalfProps {
  repository: string
  task?: GandalfTask
  pulls: InboxPull[]
  ready: boolean
  onClose: () => void
  onComplete: () => void
  renderSessionCard?: (sessionId: string) => ReactNode
}

export function GandalfCompanion({
  repository,
  task = 'conflicts',
  pulls,
  ready,
  onClose,
  onComplete,
  renderSessionCard,
}: GandalfProps) {
  const { session, busy, loading, error, act, reload } = useGandalfSession(
    repository,
    task,
    onComplete,
  )
  const [selected, setSelected] = useState<string[]>([])
  const [choosing, setChoosing] = useState(true)
  const active = session?.status === 'running'
  const selection = selected.filter((url) => pulls.some((pull) => pull.url === url))
  const showingProgress = session && (active || !choosing)
  const emotion = gandalfEmotion(showingProgress ? session : undefined)
  useCloseOnEscape(onClose)
  return (
    <aside className="gandalf-companion" aria-label={labels[task].companion}>
      <div className="gandalf-bubble">
        <GandalfHeader task={showingProgress ? session.task : task} onClose={onClose} />
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
          <>
            {renderSessionCard?.(session.id)}
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
          </>
        ) : (
          <GandalfSelection
            task={task}
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

const labels = {
  conflicts: { companion: 'Gandalf conflict companion', header: 'GANDALF · CONFLICT RESOLUTION' },
  ci: { companion: 'Gandalf CI companion', header: 'GANDALF · FIX CI' },
}

function gandalfEmotion(session: GandalfSession | undefined) {
  if (!session) return 'neutral'
  if (session.status === 'running') return 'thinking'
  return session.status === 'complete' ? 'happy' : 'angry'
}

function GandalfHeader({ task, onClose }: { task: GandalfTask; onClose: () => void }) {
  return (
    <header>
      <span>{labels[task].header}</span>
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
