import { useEffect, useEffectEvent, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { bobSnapshotMatches } from '../../../shared/domain/bob'
import { BobTour, type BobDraftContext } from './BobTour'
import { useBobTour } from './useBobTour'
import { useBobSession } from './useBobSession'
import '../../linus.css'
import './bob.css'

export function BobCompanion(
  context: BobDraftContext & {
    replaySessionId?: string
    onClose?: () => void
    onSessionUpdate?: () => void
  },
) {
  const { pull } = context
  const job = useBobSession(`${pull.owner}/${pull.repo}`, pull.url, context.replaySessionId)
  const tour = useBobTour(pull, job.session)
  const [open, setOpen] = useState(Boolean(context.replaySessionId))
  const finding = tour.result?.advice.findings[tour.index - 1]
  const current = tour.result && bobSnapshotMatches(pull, tour.result.pull)
  const focusLine = useEffectEvent(context.focusLine)
  const onSessionUpdate = useEffectEvent(() => context.onSessionUpdate?.())
  const onClose = useEffectEvent(() => context.onClose?.())
  useEffect(() => {
    onSessionUpdate()
  }, [job.session?.id, job.session?.results.length, job.session?.status])
  useEffect(() => {
    focusLine(open && current ? finding : undefined)
    return () => {
      focusLine(undefined)
    }
  }, [open, current, finding])
  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  if (!open) return null
  function close() {
    setOpen(false)
    context.onClose?.()
  }
  return (
    <aside
      className="linus-companion bob-companion linus-open"
      aria-label="Uncle Bob code review companion"
    >
      <BobPanel job={job} tour={tour} context={context} close={close} />
      <button className="linus-portrait" aria-label="Minimize Uncle Bob" onClick={close}>
        <img src={`/unclebob/${tour.emotion}.png`} alt={`Uncle Bob, ${tour.emotion}`} />
      </button>
    </aside>
  )
}

function BobPanel({
  job,
  tour,
  context,
  close,
}: {
  job: ReturnType<typeof useBobSession>
  tour: ReturnType<typeof useBobTour>
  context: BobDraftContext
  close: () => void
}) {
  const { session, loading, busy, error, act } = job
  const { result, index, advance } = tour
  const canStart =
    !loading && !busy && session?.status !== 'running' && session?.status !== 'partial'
  return (
    <div className="linus-bubble">
      <header>
        <span className="linus-eyebrow">UNCLE BOB · CODE REVIEW</span>
        <button className="linus-icon-button" aria-label="Close Uncle Bob" onClick={close}>
          <X size={16} />
        </button>
      </header>
      <BobJobControls job={job} hasResult={Boolean(result)} />
      {result && <BobTour result={result} index={index} advance={advance} context={context} />}
      {!result && (
        <p className="linus-speech">
          Let’s check how the code reads: clear functions, familiar names, shared helpers, and
          readable tests.
        </p>
      )}
      <div className="linus-footer">
        <button disabled={!canStart} onClick={() => void act('start', [context.pull.url])}>
          {result ? 'Review this PR again' : 'Review this PR'}
        </button>
      </div>
      {error && (
        <p className="linus-error" role="alert">
          {error}
          <button onClick={job.reload}>Reconnect</button>
        </p>
      )}
      {loading && (
        <p role="status" className="muted">
          Loading saved review…
        </p>
      )}
    </div>
  )
}

function BobJobControls({
  job,
  hasResult,
}: {
  job: ReturnType<typeof useBobSession>
  hasResult: boolean
}) {
  const { session, busy, act } = job
  if (!session) return null
  if (session.status === 'running')
    return (
      <div className="linus-working" role="status">
        <LoaderCircle size={15} className="animate-spin" />
        <span>{session.progress}</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
          Cancel review
        </Button>
      </div>
    )
  if (session.status === 'partial')
    return (
      <div className="linus-notice">
        <p>One reviewer couldn’t finish. {session.error}</p>
        <div className="linus-actions">
          <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
            Retry both
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('continue')}>
            Use available review
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  if (!hasResult && (session.status === 'failed' || session.status === 'cancelled'))
    return (
      <div className="linus-notice">
        <p>{session.error ?? session.progress}</p>
        <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
          Retry review
        </Button>
      </div>
    )
  return null
}
