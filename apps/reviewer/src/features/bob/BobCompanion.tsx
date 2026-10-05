import { useEffect, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { BobEvidence } from './BobEvidence'
import { BobTour, type BobDraftContext } from './BobTour'
import { useBobTour } from './useBobTour'
import { useBobSession } from './useBobSession'
import '../../linus.css'
import './bob.css'

export function BobCompanion(context: BobDraftContext) {
  const { pull } = context
  const job = useBobSession(`${pull.owner}/${pull.repo}`, pull.url)
  const tour = useBobTour(pull, job.session)
  const [open, setOpen] = useState(false)
  const [evidence, setEvidence] = useState(true)
  const finding = tour.result?.advice.findings[tour.index - 1]
  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  function advance(index: number) {
    tour.advance(index)
    setEvidence(true)
  }
  return (
    <>
      {open && evidence && tour.result && finding && (
        <BobEvidence
          result={tour.result}
          finding={finding}
          onClose={() => {
            setEvidence(false)
          }}
        />
      )}
      <aside
        className={`linus-companion bob-companion ${open ? 'linus-open' : 'linus-minimized'}`}
        aria-label="Bob code review companion"
      >
        {open && (
          <BobPanel
            job={job}
            tour={{ ...tour, advance }}
            context={context}
            close={() => {
              setOpen(false)
            }}
            showEvidence={() => {
              setEvidence(true)
            }}
          />
        )}
        <button
          className="linus-portrait"
          aria-label={open ? 'Minimize Bob' : 'Open Bob code review'}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <img src={`/unclebob/${tour.emotion}.png`} alt={`Bob, ${tour.emotion}`} />
          {!open && <span>Bob{job.session?.status === 'running' ? ' · reviewing' : ''}</span>}
        </button>
      </aside>
    </>
  )
}

function BobPanel({
  job,
  tour,
  context,
  close,
  showEvidence,
}: {
  job: ReturnType<typeof useBobSession>
  tour: ReturnType<typeof useBobTour>
  context: BobDraftContext
  close: () => void
  showEvidence: () => void
}) {
  const { session, loading, busy, error, act } = job
  const { result, index, advance } = tour
  const canStart =
    !loading && !busy && session?.status !== 'running' && session?.status !== 'partial'
  return (
    <div className="linus-bubble">
      <header>
        <span className="linus-eyebrow">BOB · CODE REVIEW</span>
        <button className="linus-icon-button" aria-label="Close Bob" onClick={close}>
          <X size={16} />
        </button>
      </header>
      <BobJobControls job={job} hasResult={Boolean(result)} />
      {result && (
        <BobTour
          result={result}
          index={index}
          advance={advance}
          context={context}
          showEvidence={showEvidence}
        />
      )}
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
