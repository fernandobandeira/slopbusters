import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import { anchorLine } from '../../../shared/domain/anchors'
import { snapshotMatches } from '../../../shared/domain/findings'
import { seatRequests, type PanelSession } from '../../../shared/domain/panel'
import type { Teammate } from '../../../shared/domain/teammates'
import { ContinueInT3CodeButton } from '../../components/ContinueInT3CodeButton'
import { ReviewerFace } from '../../components/ReviewerFace'
import { PanelStack } from './PanelStack'
import { ProviderMark } from './ProviderMark'
import { call, message } from '../../lib/api'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'
import { useApiQuery } from '../../lib/useApiQuery'
import { PanelTour, type PanelDraftContext } from './PanelTour'
import { usePanelSession } from './usePanelSession'
import { usePanelTour } from './usePanelTour'
import '../../linus.css'
import '../../findingTour.css'
import './panel.css'

type Job = ReturnType<typeof usePanelSession>
type Tour = ReturnType<typeof usePanelTour>

/** The review panel's companion: reviewers at work, then the judged findings one by one. */
export function PanelCompanion(
  context: PanelDraftContext & {
    sessionId: string
    onOpen: (sessionId: string) => void
    onClose: () => void
    onSessionUpdate?: () => void
    renderSessionCard?: (sessionId: string) => ReactNode
  },
) {
  const job = usePanelSession(context.sessionId)
  const tour = usePanelTour(context.pull, job.session)
  const teammates = useApiQuery(routes.listTeammates, {}).data?.teammates
  const current = tour.result && snapshotMatches(context.pull, tour.result.pull)
  const focusLine = useEffectEvent(context.focusLine)
  const onSessionUpdate = useEffectEvent(() => context.onSessionUpdate?.())
  const onClose = useEffectEvent(context.onClose)
  useEffect(() => {
    onSessionUpdate()
  }, [job.session?.id, job.session?.results.length, job.session?.status])
  useEffect(() => {
    focusLine(current && tour.finding ? anchorLine(tour.finding.anchor) : undefined)
    return () => {
      focusLine(undefined)
    }
  }, [current, tour.finding])
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  return (
    <aside
      className="linus-companion finding-companion panel-companion linus-open"
      aria-label="Review panel companion"
    >
      <div className="linus-bubble">
        <header>
          <span className="linus-eyebrow">REVIEW PANEL</span>
          <button
            className="linus-icon-button"
            aria-label="Close the review panel"
            onClick={context.onClose}
          >
            <X size={16} />
          </button>
        </header>
        {job.session && context.renderSessionCard?.(job.session.id)}
        <PanelBody job={job} tour={tour} teammates={teammates} context={context} />
      </div>
      <Portrait session={job.session} tour={tour} teammates={teammates} onClose={context.onClose} />
    </aside>
  )
}

function PanelBody({
  job,
  tour,
  teammates,
  context,
}: {
  job: Job
  tour: Tour
  teammates?: Teammate[]
  context: PanelDraftContext & { onOpen: (sessionId: string) => void }
}) {
  const { session, loading, error } = job
  return (
    <>
      {session && (
        <PanelProgress
          job={job}
          session={session}
          teammates={teammates}
          hasResult={Boolean(tour.result)}
        />
      )}
      {session && tour.result && (
        <PanelTour
          result={tour.result}
          reviewers={session.reviewers}
          teammates={teammates}
          index={tour.index}
          advance={tour.advance}
          context={context}
        />
      )}
      {session && tour.index === 0 && (
        <ContinueWith session={session} url={context.pull.url} teammates={teammates} />
      )}
      {session && !blocking(session) && (
        <ReviewAgain session={session} url={context.pull.url} onOpen={context.onOpen} />
      )}
      {error && (
        <p className="linus-error" role="alert">
          {error}
          <button onClick={job.reload}>Reconnect</button>
        </p>
      )}
      {loading && (
        <p role="status" className="muted">
          Loading the panel review…
        </p>
      )}
    </>
  )
}

/** While reviewers work: who is done, who failed, and what the user can do about it. */
function PanelProgress({
  job,
  session,
  teammates,
  hasResult,
}: {
  job: Job
  session: PanelSession
  teammates?: Teammate[]
  hasResult: boolean
}) {
  const { busy, act } = job
  const showRoster = session.status === 'running' || session.status === 'partial'
  return (
    <>
      {showRoster && <ReviewerRoster session={session} teammates={teammates} />}
      {session.status === 'running' && (
        <div className="linus-working" role="status">
          <LoaderCircle size={15} className="animate-spin" />
          <span>{session.progress}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Cancel review
          </Button>
        </div>
      )}
      {session.status === 'partial' && (
        <div className="linus-notice">
          <p>{session.progress}</p>
          <div className="linus-actions">
            <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
              Retry them
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act('continue')}
            >
              Judge without them
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!hasResult && (session.status === 'failed' || session.status === 'cancelled') && (
        <div className="linus-notice">
          <p>{session.error ?? session.progress}</p>
          <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
            Retry review
          </Button>
        </div>
      )}
    </>
  )
}

function ReviewerRoster({ session, teammates }: { session: PanelSession; teammates?: Teammate[] }) {
  const reviews = session.pending?.reviews ?? []
  return (
    <ul className="panel-roster" aria-label="Reviewers">
      {session.reviewers.map((reviewer) => {
        const review = reviews.find((item) => item.reviewer === reviewer.id)
        const state = review ? (review.advice ? 'done' : 'failed') : 'working'
        return (
          <li key={reviewer.id} className={`panel-roster-${state}`} title={review?.error}>
            <ReviewerFace
              name={reviewer.name}
              src={reviewerFaceSrc(
                reviewer.id,
                state === 'failed' ? 'resigned' : 'thinking',
                teammates,
              )}
              size={24}
            />
            <span>{reviewer.name}</span>
            <ProviderMark reviewer={reviewer} />
            {state === 'done' && <Check size={13} aria-label="finished" />}
            {state === 'failed' && <CircleAlert size={13} aria-label="failed" />}
            {state === 'working' && session.status === 'running' && (
              <LoaderCircle size={13} className="animate-spin" aria-label="reviewing" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Talk a reviewer's part through in T3 Code, through its own installed skill. */
function ContinueWith({
  session,
  url,
  teammates,
}: {
  session: PanelSession
  url: string
  teammates?: Teammate[]
}) {
  const reviews = (session.results.find((result) => result.pull.url === url) ?? session.pending)
    ?.reviews
  const ready = session.reviewers.filter((reviewer) =>
    reviews?.some((review) => review.reviewer === reviewer.id && review.advice),
  )
  if (!ready.length) return null
  return (
    <details className="finding-notes panel-continue">
      <summary>Continue with a reviewer in T3 Code</summary>
      <ul>
        {ready.map((reviewer) => (
          <li key={reviewer.id}>
            <ReviewerFace
              name={reviewer.name}
              src={reviewerFaceSrc(reviewer.id, 'neutral', teammates)}
              size={22}
            />
            <span>{reviewer.name}</span>
            <ContinueInT3CodeButton
              request={{ persona: 'panel', sessionId: session.id, url, reviewer: reviewer.id }}
            />
          </li>
        ))}
      </ul>
    </details>
  )
}

function ReviewAgain({
  session,
  url,
  onOpen,
}: {
  session: PanelSession
  url: string
  onOpen: (sessionId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function start() {
    setBusy(true)
    setError('')
    try {
      const reviewers = seatRequests(session.reviewers, session.model.provider)
      const next = await call(routes.startPanel, {
        body: { repository: session.repository, urls: [url], reviewers },
      })
      onOpen(next.id)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="linus-footer">
      <button disabled={busy} onClick={() => void start()}>
        Review this PR again with the same panel
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

/** The whole panel while it works and on the summary; on a finding, whoever raised it first. */
function Portrait({
  session,
  tour,
  teammates,
  onClose,
}: {
  session?: PanelSession
  tour: Tour
  teammates?: Teammate[]
  onClose: () => void
}) {
  const speaker = tour.finding?.raisedBy[0]
  const name = session?.reviewers.find((reviewer) => reviewer.id === speaker)?.name
  return (
    <button
      className="linus-portrait panel-portrait"
      aria-label="Minimize the review panel"
      onClick={onClose}
    >
      {speaker && name ? (
        <ReviewerFace
          name={name}
          src={reviewerFaceSrc(speaker, tour.mood, teammates)}
          size={112}
          label={`${name}, ${tour.mood}`}
        />
      ) : session ? (
        <PanelStack session={session} mood={tour.mood} teammates={teammates} />
      ) : null}
    </button>
  )
}

function blocking(session: PanelSession) {
  return session.status === 'running' || session.status === 'partial'
}
