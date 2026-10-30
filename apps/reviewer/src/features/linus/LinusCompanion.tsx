import { useClipboard } from '../../lib/useClipboard'
import * as routes from '../../../shared/api'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  Maximize2,
  X,
} from 'lucide-react'
import {
  recommendationsPrompt,
  verdictLabels,
  type LinusResult,
  type LinusSession,
  type LinusStep,
  type LinusReplayRequest,
} from '../../../shared/domain/linus'
import {
  Priority,
  type ChangedFile,
  type Hunk,
  type InboxPull,
  type PullRequest,
} from '../../../shared/domain/types'
import { reviewedPullsLabel } from '../../../shared/domain/reviewSession'
import { Button } from '~/components/ui/button'
import { PullDescription } from '../review/PullDescription'
import { ReviewDiffCodeView } from '../../components/ReviewDiffCodeView'
import { ContinueInT3CodeButton } from '../../components/ContinueInT3CodeButton'
import { diffItems } from '../review/diff/diffItems'
import { useReviewerTheme } from '../../app/ThemeProvider'
import { linusReviewTurns } from './linusReviewTurns'
import { useLinusSession } from './useLinusSession'
import { call, message } from '../../lib/api'
import { reviewPath } from '../../lib/routes'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'
import '../../linus.css'

function LinusDiffEvidence({
  pull,
  file,
  hunk,
}: {
  pull: PullRequest
  file: ChangedFile
  hunk: Hunk
}) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  const items = useMemo(
    () =>
      diffItems(pull, {
        id: hunk.id,
        title: file.path,
        priority: Priority.normal,
        reason: '',
        fileIds: [file.id],
        hunkIds: [hunk.id],
      }),
    [pull, file, hunk],
  )
  return (
    <ReviewDiffCodeView
      key={`${pull.id}:${hunk.id}`}
      className="linus-diff"
      items={items}
      options={{
        theme: themeId,
        themeType: resolvedTheme,
        diffStyle: 'unified',
        overflow: 'wrap',
      }}
    />
  )
}

function LinusEvidence({
  result,
  step,
  onClose,
}: {
  result: LinusResult
  step: LinusStep
  onClose: () => void
}) {
  const { pull, advice } = result
  const file = pull.files.find((item) => item.hunks.some((hunk) => hunk.id === step.reference))
  const hunk = file?.hunks.find((item) => item.id === step.reference)
  const showingDiff = step.target === 'diff' && hunk && file
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step.target !== 'description') body.current?.scrollTo({ top: 0 })
  }, [step.target, step.reference, pull.id])
  return (
    <section className="linus-evidence" aria-label={`Evidence for PR #${pull.number}`}>
      <header>
        <div>
          <span className="linus-eyebrow">LINUS’S REVIEW · PR #{pull.number}</span>
          <h2>{pull.title}</h2>
        </div>
        <button className="linus-icon-button" aria-label="Close evidence" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="linus-evidence-meta">
        <span>{verdictLabels[advice.verdict]}</span>
        <span>Reviewed {pull.headSha.slice(0, 8)}</span>
        <Link to={reviewPath({ url: pull.url, filter: 'mine' })} onClick={onClose}>
          Open full PR <ArrowUpRight size={13} />
        </Link>
      </div>
      <div className={`linus-evidence-body${showingDiff ? ' linus-evidence-code' : ''}`} ref={body}>
        {showingDiff ? (
          <LinusDiffEvidence pull={pull} file={file} hunk={hunk} />
        ) : (
          <>
            <PullDescription
              pull={pull}
              focusQuote={step.target === 'description' ? step.reference : undefined}
            />
            {step.target === 'overview' && (
              <div className="linus-proposal">
                <h3>{verdictLabels[advice.verdict]}</h3>
                <p>{advice.reasoning}</p>
                {advice.layers.length > 0 && (
                  <ol>
                    {advice.layers.map((layer, index) => (
                      <li key={index}>
                        <strong>{layer.title}</strong>
                        <p>{layer.reason}</p>
                        <p className="muted">
                          Depends on: {layer.dependsOn.join(', ') || 'none'}. Verification plan:{' '}
                          {layer.verification}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
                {advice.revisedTitle && (
                  <>
                    <h3>Proposed title</h3>
                    <p>{advice.revisedTitle}</p>
                  </>
                )}
                {advice.revisedDescription && (
                  <>
                    <h3>Proposed description</h3>
                    <PullDescription pull={{ ...pull, description: advice.revisedDescription }} />
                  </>
                )}
                {advice.limitations.length > 0 && (
                  <details>
                    <summary>Review limitations</summary>
                    <ul>
                      {advice.limitations.map((limitation, index) => (
                        <li key={index}>{limitation}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {advice.disagreements.length > 0 && (
                  <details>
                    <summary>Unresolved disagreements</summary>
                    <ul>
                      {advice.disagreements.map((disagreement, index) => (
                        <li key={index}>{disagreement}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** The PR a partial review stopped on, so the user knows which review is waiting. */
function unfinishedPull(session: LinusSession) {
  const next = session.urls[session.results.length]
  return reviewedPullsLabel(next ? [next] : [])
}

/** Carries Linus's review of one PR on in a T3 Code thread. */
function ContinueLinus({ sessionId, url }: { sessionId?: string; url?: string }) {
  if (!sessionId || !url) return null
  return <ContinueInT3CodeButton request={{ persona: 'linus', sessionId, url }} />
}

export function LinusCompanion({
  repository,
  pulls,
  currentPull,
  replayRequest,
  onSessionUpdate,
  sessionId,
  renderSessionCard,
  onClose,
}: {
  repository: string
  pulls: InboxPull[]
  currentPull?: PullRequest
  replayRequest?: LinusReplayRequest
  onSessionUpdate?: () => void
  sessionId?: string
  renderSessionCard?: (sessionId: string) => ReactNode
  onClose?: () => void
}) {
  const { session, loading, busy, error, act, reload } = useLinusSession(repository, sessionId)
  const [open, setOpen] = useState(Boolean(sessionId || replayRequest))
  const [cursor, setCursor] = useState<{ sessionId: string; index: number }>()
  const [hiddenEvidenceTurn, setHiddenEvidenceTurn] = useState<string>()
  const { state: clipboardState, copy: copyClipboard, reset: resetClipboard } = useClipboard()
  const [copyFallback, setCopyFallback] = useState(false)
  const copyState = copyFallback ? 'fallback' : clipboardState
  const [copyText, setCopyText] = useState('')
  const [replayed, setReplayed] = useState<{ request: LinusReplayRequest; result: LinusResult }>()
  const [replayError, setReplayError] = useState<{ request: LinusReplayRequest; message: string }>()
  const replayMessage = replayError?.request === replayRequest ? replayError?.message : undefined
  const savedResult = replayed?.request === replayRequest ? replayed?.result : undefined
  const replayLoading = Boolean(replayRequest && !savedResult && !replayMessage)
  const reviewId = savedResult
    ? `saved:${replayRequest!.sessionId}:${savedResult.pull.url}`
    : session?.id
  const results = useMemo(
    () => (savedResult ? [savedResult] : (session?.results ?? [])),
    [savedResult, session?.results],
  )
  const turns = useMemo(() => linusReviewTurns(results), [results])
  const storedCursor = reviewId
    ? Number(localStorage.getItem(`slopbusters:linus-turn:${reviewId}`) ?? 0)
    : 0
  const index = Math.min(
    Math.max(
      0,
      cursor && cursor.sessionId === reviewId
        ? cursor.index
        : Number.isFinite(storedCursor)
          ? storedCursor
          : 0,
    ),
    Math.max(0, turns.length - 1),
  )
  const turn = turns[index]
  const result = turn?.result
  const turnKey = result ? `${reviewId}:${index}:${result.fingerprint}` : ''
  const evidence = Boolean(turnKey && hiddenEvidenceTurn !== turnKey)
  const activitySessionId = replayRequest?.sessionId ?? session?.id
  const active = session?.status === 'running'
  const reviewMode = !replayLoading
  const emotion =
    active && !turn
      ? 'thinking'
      : reviewMode && turn
        ? turn.step.emotion
        : session?.status === 'failed' && reviewMode
          ? 'resigned'
          : 'neutral'
  const current =
    result &&
    (pulls.find((pull) => pull.url === result.pull.url) ??
      (currentPull?.url === result.pull.url ? currentPull : undefined))
  const stale =
    current &&
    result &&
    (current.headSha !== result.pull.headSha ||
      current.title !== result.pull.title ||
      ('description' in current && current.description !== result.pull.description))

  useEffect(() => {
    onSessionUpdate?.()
  }, [session?.id, session?.results.length, session?.status, onSessionUpdate])
  useEffect(() => {
    if (!replayRequest) return
    const controller = new AbortController()
    void call(
      routes.getLinus,
      { params: { id: replayRequest.sessionId } },
      { signal: controller.signal },
    )
      .then((saved) => {
        if (controller.signal.aborted) return
        const result = saved.results.find((item) => item.pull.url === replayRequest.url)
        if (!result) throw new Error('Saved recommendations for this PR are no longer available.')
        setReplayed({ request: replayRequest, result })
        setReplayError(undefined)
        setCursor({ sessionId: `saved:${saved.id}:${result.pull.url}`, index: 0 })
        setHiddenEvidenceTurn(undefined)
        setCopyFallback(false)
        resetClipboard()
        setOpen(true)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setReplayError({ request: replayRequest, message: message(cause) })
          setOpen(true)
        }
      })
    return () => {
      controller.abort()
    }
  }, [replayRequest, resetClipboard])

  useEffect(() => {
    if (!open) return
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setHiddenEvidenceTurn(turnKey)
        onClose?.()
      }
    }
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', escape)
    }
  }, [open, turnKey, onClose])

  if (!repository || !open) return null
  function close() {
    setOpen(false)
    setHiddenEvidenceTurn(turnKey)
    onClose?.()
  }
  function advance(next: number) {
    if (!reviewId) return
    setCursor({ sessionId: reviewId, index: next })
    localStorage.setItem(`slopbusters:linus-turn:${reviewId}`, String(next))
    setHiddenEvidenceTurn(undefined)
  }
  async function copy(completed?: LinusResult) {
    const text = recommendationsPrompt(completed ? [completed] : results)
    setCopyText(text)
    setCopyFallback(!(await copyClipboard(text)))
  }
  return (
    <>
      {evidence && reviewMode && turn && (
        <LinusEvidence
          result={turn.result}
          step={turn.step}
          onClose={() => {
            setHiddenEvidenceTurn(turnKey)
          }}
        />
      )}
      <aside className="linus-companion linus-open" aria-label="Linus PR companion">
        <div className="linus-bubble">
          <header>
            <span className="linus-eyebrow">LINUS · PR REVIEW</span>
            <button className="linus-icon-button" aria-label="Close Linus" onClick={close}>
              <X size={16} />
            </button>
          </header>
          {activitySessionId && renderSessionCard?.(activitySessionId)}
          {reviewMode && (
            <>
              {active && !savedResult && (
                <div
                  className={`linus-working${turn ? ' linus-working-compact' : ''}`}
                  role="status"
                >
                  <LoaderCircle size={15} className="animate-spin" />
                  <div>
                    {!turn && <strong>Compiling opinions…</strong>}
                    <span>{session.progress}</span>
                  </div>
                </div>
              )}
              {session?.status === 'partial' && !savedResult && (
                <div className="linus-notice">
                  <p>
                    One reviewer couldn’t finish {unfinishedPull(session)}. I have the other review.
                  </p>
                  <p className="muted linus-small">{session.error}</p>
                  <div className="linus-actions">
                    <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
                      Retry both
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void act('continue')}
                    >
                      Use available review
                    </Button>
                    <ContinueLinus sessionId={session.id} url={session.pending?.pull.url} />
                  </div>
                </div>
              )}
              {!savedResult &&
                (session?.status === 'failed' || session?.status === 'cancelled') && (
                  <div className="linus-notice">
                    <p>{session.error ?? session.progress}</p>
                    <Button size="sm" disabled={busy} onClick={() => void act('retry')}>
                      Retry remaining PRs
                    </Button>
                  </div>
                )}
              {turn && (
                <>
                  <div className="linus-turn-meta">
                    <span>PR #{turn.result.pull.number}</span>
                    <span>
                      {index + 1} / {turns.length}
                      {active && !savedResult ? ' so far' : ''}
                    </span>
                  </div>
                  <strong className="linus-verdict">
                    {verdictLabels[turn.result.advice.verdict]}
                  </strong>
                  <p className="linus-speech" aria-live="polite">
                    {turn.step.text}
                  </p>
                  {stale && (
                    <p className="linus-notice">
                      This PR changed after the review. These recommendations describe the saved
                      snapshot.
                    </p>
                  )}
                  <div className="linus-tour-controls">
                    <div className="linus-actions">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Copy PR #${turn.result.pull.number} recommendations`}
                        title="Copy this PR’s recommendations"
                        onClick={() => void copy(turn.result)}
                      >
                        <Copy size={14} />
                      </Button>
                      {!evidence && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Show evidence"
                          title="Show evidence"
                          onClick={() => {
                            setHiddenEvidenceTurn(undefined)
                          }}
                        >
                          <Maximize2 size={14} />
                        </Button>
                      )}
                    </div>
                    <div className="linus-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => {
                          advance(index - 1)
                        }}
                      >
                        <ChevronLeft size={14} /> Back
                      </Button>
                      <Button
                        size="sm"
                        disabled={index >= turns.length - 1}
                        onClick={() => {
                          advance(index + 1)
                        }}
                      >
                        {turns[index + 1] && turns[index + 1]?.result !== turn.result
                          ? 'Next PR'
                          : 'Next'}
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="linus-actions linus-continue">
                    <ContinueLinus sessionId={activitySessionId} url={turn.result.pull.url} />
                  </div>
                </>
              )}
              {!turn && session?.status === 'complete' && (
                <p className="linus-speech">The review is complete.</p>
              )}
              {!turn && !session && !busy && !loading && (
                <p className="muted">Select PRs in the list and ask Linus to start a review.</p>
              )}
              <div className="linus-footer">
                {turn && results.length > 1 && (
                  <button onClick={() => void copy()}>
                    <Copy size={13} /> Copy all recommendations
                  </button>
                )}
                {(active || session?.status === 'partial') && !savedResult && (
                  <button disabled={busy} onClick={() => void act('cancel')}>
                    Cancel review
                  </button>
                )}
              </div>
            </>
          )}
          {loading && (
            <p className="muted" role="status">
              Loading saved review…
            </p>
          )}
          {replayLoading && (
            <p className="muted" role="status">
              Loading saved recommendations…
            </p>
          )}
          {error && (
            <p className="linus-error" role="alert">
              {error} <button onClick={reload}>Reconnect</button>
            </p>
          )}
          {replayMessage && (
            <p className="linus-error" role="alert">
              {replayMessage}
            </p>
          )}
          {copyState === 'copied' && (
            <p className="linus-copy-status" role="status">
              <Check size={13} /> Prompt copied
            </p>
          )}
          {copyState === 'fallback' && (
            <div className="linus-copy-fallback">
              <label htmlFor="linus-export">Select and copy your recommendations</label>
              <textarea
                id="linus-export"
                value={copyText}
                readOnly
                onFocus={(event) => {
                  event.target.select()
                }}
              />
              <button
                onClick={() => {
                  setCopyFallback(false)
                  resetClipboard()
                }}
              >
                Close export
              </button>
            </div>
          )}
        </div>
        <button className="linus-portrait" aria-label="Minimize Linus" onClick={close}>
          <ReviewerFace
            name="Linus"
            src={personaFaceSrc('linus', emotion)}
            size={112}
            label={`Linus, ${emotion}`}
          />
        </button>
      </aside>
    </>
  )
}
