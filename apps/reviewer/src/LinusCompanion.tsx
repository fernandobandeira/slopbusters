import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  type LinusStep,
  type LinusSession,
  type LinusReplayRequest,
} from '../shared/linus'
import {
  Priority,
  type ChangedFile,
  type Hunk,
  type InboxPull,
  type PullRequest,
} from '../shared/types'
import type { Preferences } from '../shared/preferences'
import { Button } from './vendor/t3/components/ui/button'
import { PullDescription } from './PullDescription'
import { StyledDiffCodeView } from './vendor/t3/components/diffs/StyledDiffCodeView'
import { diffItems } from './diffItems'
import { useReviewerTheme } from './ThemeProvider'
import { linusReviewTurns } from './linusReviewTurns'
import { LinusPullSelection, type LinusPullSelectionState } from './LinusPullSelection'
import { useLinusSession } from './useLinusSession'
import { api, message } from './api'
import { reviewPath } from './routes'
import './linus.css'

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
    <StyledDiffCodeView
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
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export function LinusCompanion({
  repository,
  pulls,
  available,
  preferences,
  currentPull,
  selection,
  replayRequest,
  onSessionUpdate,
}: {
  repository: string
  pulls: InboxPull[]
  available: boolean
  preferences?: Preferences
  currentPull?: PullRequest
  selection?: LinusPullSelectionState
  replayRequest?: LinusReplayRequest
  onSessionUpdate?: () => void
}) {
  const { session, loading, busy, error, act, reload } = useLinusSession(repository)
  const [open, setOpen] = useState(
    () => localStorage.getItem('slopbusters:linus-dismissed') !== '1',
  )
  const [mode, setMode] = useState<'intro' | 'review'>('intro')
  const selecting = selection?.active ?? false
  const [cursor, setCursor] = useState<{ sessionId: string; index: number }>()
  const [hiddenEvidenceTurn, setHiddenEvidenceTurn] = useState<string>()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'fallback'>('idle')
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
  const evidence = Boolean(turnKey && !turn?.transition && hiddenEvidenceTurn !== turnKey)
  const active = session?.status === 'running'
  const reviewMode = mode === 'review' && !selecting && !replayLoading
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
    void api<LinusSession>(`/linus/${encodeURIComponent(replayRequest.sessionId)}`, {
      signal: controller.signal,
    })
      .then((saved) => {
        if (controller.signal.aborted) return
        const result = saved.results.find((item) => item.pull.url === replayRequest.url)
        if (!result) throw new Error('Saved recommendations for this PR are no longer available.')
        setReplayed({ request: replayRequest, result })
        setReplayError(undefined)
        setCursor({ sessionId: `saved:${saved.id}:${result.pull.url}`, index: 0 })
        setHiddenEvidenceTurn(undefined)
        setCopyState('idle')
        setMode('review')
        setOpen(true)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setReplayError({ request: replayRequest, message: message(cause) })
          setOpen(true)
        }
      })
    return () => controller.abort()
  }, [replayRequest])

  useEffect(() => {
    if (!open) return
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setHiddenEvidenceTurn(turnKey)
        selection?.onCancel()
        localStorage.setItem('slopbusters:linus-dismissed', '1')
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, turnKey, selection])
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copyState])

  if (!repository || (!available && !session && !replayRequest)) return null
  function close() {
    setOpen(false)
    setHiddenEvidenceTurn(turnKey)
    selection?.onCancel()
    localStorage.setItem('slopbusters:linus-dismissed', '1')
  }
  function resume() {
    setMode('review')
    setHiddenEvidenceTurn(undefined)
    setOpen(true)
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
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('fallback')
    }
  }
  const canSelect = available && !active && session?.status !== 'partial'
  function choosePulls() {
    setHiddenEvidenceTurn(turnKey)
    setCopyState('idle')
    selection?.onChoose()
  }
  return (
    <>
      {open &&
        selecting &&
        selection?.target &&
        createPortal(
          <LinusPullSelection
            pulls={pulls}
            selected={selection.urls}
            ready={Boolean(preferences?.organization)}
            busy={busy}
            onChange={selection.onChange}
            onCancel={selection.onCancel}
            onStart={() => {
              setMode('review')
              setHiddenEvidenceTurn(turnKey)
              selection.onCancel()
              void act(
                'start',
                selection.urls.filter((url) => pulls.some((pull) => pull.url === url)),
              )
            }}
          />,
          selection.target,
        )}
      {open && evidence && reviewMode && turn && (
        <LinusEvidence
          result={turn.result}
          step={turn.step}
          onClose={() => setHiddenEvidenceTurn(turnKey)}
        />
      )}
      <aside
        className={`linus-companion ${open ? 'linus-open' : 'linus-minimized'}`}
        aria-label="Linus PR companion"
      >
        {open && (
          <div className="linus-bubble">
            <header>
              <span className="linus-eyebrow">LINUS · PR REVIEW</span>
              <button className="linus-icon-button" aria-label="Close Linus" onClick={close}>
                <X size={16} />
              </button>
            </header>
            {mode === 'intro' && !selecting && !replayLoading && (
              <>
                <p className="linus-speech">
                  {active
                    ? 'I’m still looking. You can carry on while I compile my opinions.'
                    : session?.results.length
                      ? 'I’ve got some thoughts on your PRs. Want to walk through them?'
                      : 'Want me to look over your PRs? Let’s see whether the descriptions earn their keep.'}
                </p>
                <div className="linus-actions">
                  {session && (
                    <Button size="sm" onClick={resume}>
                      {session.results.length ? 'Resume review' : 'Show review'}
                    </Button>
                  )}
                  {canSelect && (
                    <Button
                      size="sm"
                      variant={session ? 'outline' : 'default'}
                      disabled={loading}
                      onClick={choosePulls}
                    >
                      Choose PRs
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={close}>
                    Later
                  </Button>
                </div>
              </>
            )}
            {selecting && (
              <p className="linus-speech">Select the PRs you want me to review from your list.</p>
            )}
            {reviewMode && (
              <>
                {active && !savedResult && (
                  <div className="linus-working" role="status">
                    <LoaderCircle size={15} className="animate-spin" />
                    <div>
                      <strong>Compiling opinions…</strong>
                      <span>{session.progress}</span>
                    </div>
                  </div>
                )}
                {session?.status === 'partial' && !savedResult && (
                  <div className="linus-notice">
                    <p>One reviewer couldn’t finish. I have the other review.</p>
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
                      <span>
                        {turn.transition ? `PR #${turn.transition.pull.number} → ` : ''}
                        PR #{turn.result.pull.number}
                      </span>
                      <span>
                        {index + 1} / {turns.length}
                        {active && !savedResult ? ' so far' : ''}
                      </span>
                    </div>
                    {!turn.transition && (
                      <strong className="linus-verdict">
                        {verdictLabels[turn.result.advice.verdict]}
                      </strong>
                    )}
                    <p className="linus-speech" aria-live="polite">
                      {turn.step.text}
                    </p>
                    {stale && !turn.transition && (
                      <p className="linus-notice">
                        This PR changed after the review. These recommendations describe the saved
                        snapshot.
                      </p>
                    )}
                    <div className="linus-actions linus-tour-controls">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => advance(index - 1)}
                      >
                        <ChevronLeft size={14} /> Back
                      </Button>
                      {!turn.transition && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setHiddenEvidenceTurn(evidence ? turnKey : undefined)}
                        >
                          <Maximize2 size={13} />
                          {evidence ? 'Hide evidence' : 'Show evidence'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={index >= turns.length - 1}
                        onClick={() => advance(index + 1)}
                      >
                        {turn.transition ? `Review PR #${turn.result.pull.number}` : 'Next'}
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                    <div className="linus-copy-actions">
                      {turn.transition && (
                        <button onClick={() => void copy(turn.transition)}>
                          <Copy size={13} /> Copy PR #{turn.transition.pull.number} recommendations
                        </button>
                      )}
                      <button onClick={() => void copy()}>
                        <Copy size={13} />{' '}
                        {savedResult ? 'Copy recommendations' : 'Copy all recommendations'}
                      </button>
                    </div>
                  </>
                )}
                {!turn && session?.status === 'complete' && (
                  <p className="linus-speech">The review is complete.</p>
                )}
                {!turn && !session && !busy && (
                  <p className="muted">Choose PRs to start a review.</p>
                )}
                <div className="linus-footer">
                  {active && !savedResult && (
                    <button disabled={busy} onClick={() => void act('cancel')}>
                      Cancel review
                    </button>
                  )}
                  {session?.status === 'partial' && !savedResult && (
                    <button disabled={busy} onClick={() => void act('cancel')}>
                      Cancel review
                    </button>
                  )}
                  {canSelect && <button onClick={choosePulls}>Review other PRs</button>}
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
                  onFocus={(event) => event.target.select()}
                />
                <button onClick={() => setCopyState('idle')}>Close export</button>
              </div>
            )}
          </div>
        )}
        <button
          className="linus-portrait"
          aria-label={open ? 'Minimize Linus' : 'Open Linus PR review'}
          onClick={() => {
            if (open) close()
            else {
              setOpen(true)
              setHiddenEvidenceTurn(undefined)
              localStorage.removeItem('slopbusters:linus-dismissed')
            }
          }}
        >
          <img src={`/linus/${emotion}.png`} alt={`Linus, ${emotion}`} />
          {!open && <span>Linus{active ? ' · reviewing' : ''}</span>}
        </button>
      </aside>
    </>
  )
}
