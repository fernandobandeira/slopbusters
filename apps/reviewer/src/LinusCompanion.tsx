import { useEffect, useRef, useState } from 'react'
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
} from '../shared/linus'
import { LineKind, type InboxPull, type PullRequest } from '../shared/types'
import type { Preferences } from '../shared/preferences'
import { Button } from './vendor/t3/components/ui/button'
import { PullDescription } from './PullDescription'
import { useLinusSession } from './useLinusSession'
import { reviewPath } from './routes'
import './linus.css'

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
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step.target !== 'description') body.current?.scrollTo({ top: 0 })
  }, [step])
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
      <div className="linus-evidence-body" ref={body}>
        {step.target === 'diff' && hunk && file ? (
          <div className="linus-diff">
            <strong>{file.path}</strong>
            <p className="muted">{hunk.header}</p>
            <pre>
              {hunk.lines.map((line) => (
                <div key={line.id} className={`linus-line-${line.kind}`}>
                  <span className="linus-line-number">{line.newLine ?? line.oldLine ?? ''}</span>
                  <span>
                    {line.kind === LineKind.added
                      ? '+'
                      : line.kind === LineKind.removed
                        ? '−'
                        : ' '}{' '}
                    {line.text}
                  </span>
                </div>
              ))}
            </pre>
          </div>
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
}: {
  repository: string
  pulls: InboxPull[]
  available: boolean
  preferences?: Preferences
  currentPull?: PullRequest
}) {
  const { session, loading, busy, error, act, reload } = useLinusSession(repository)
  const [open, setOpen] = useState(
    () => localStorage.getItem('slopbusters:linus-dismissed') !== '1',
  )
  const [mode, setMode] = useState<'intro' | 'select' | 'review'>('intro')
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState<{ sessionId: string; index: number }>()
  const [hiddenEvidenceTurn, setHiddenEvidenceTurn] = useState<string>()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [copyText, setCopyText] = useState('')
  const turns =
    session?.results.flatMap((result) => result.advice.steps.map((step) => ({ result, step }))) ??
    []
  const storedCursor = session
    ? Number(localStorage.getItem(`slopbusters:linus-turn:${session.id}`) ?? 0)
    : 0
  const index = Math.min(
    Math.max(
      0,
      cursor && cursor.sessionId === session?.id
        ? cursor.index
        : Number.isFinite(storedCursor)
          ? storedCursor
          : 0,
    ),
    Math.max(0, turns.length - 1),
  )
  const turn = turns[index]
  const result = turn?.result
  const turnKey = result ? `${session!.id}:${index}:${result.fingerprint}` : ''
  const evidence = Boolean(turnKey && hiddenEvidenceTurn !== turnKey)
  const active = session?.status === 'running'
  const reviewMode = mode === 'review'
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
    if (!open) return
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setHiddenEvidenceTurn(turnKey)
        localStorage.setItem('slopbusters:linus-dismissed', '1')
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, turnKey])
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copyState])

  if (!repository || (!available && !session)) return null
  function close() {
    setOpen(false)
    setHiddenEvidenceTurn(turnKey)
    localStorage.setItem('slopbusters:linus-dismissed', '1')
  }
  function resume() {
    setMode('review')
    setHiddenEvidenceTurn(undefined)
    setOpen(true)
  }
  function advance(next: number) {
    if (!session) return
    setCursor({ sessionId: session.id, index: next })
    localStorage.setItem(`slopbusters:linus-turn:${session.id}`, String(next))
    setHiddenEvidenceTurn(undefined)
  }
  async function copy(all: boolean) {
    const chosen = all ? (session?.results ?? []) : result ? [result] : []
    const text = recommendationsPrompt(chosen)
    setCopyText(text)
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('fallback')
    }
  }
  const canSelect = available && !active && session?.status !== 'partial'
  return (
    <>
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
            {mode === 'intro' && (
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
                      onClick={() => {
                        setMode('select')
                        setSelected([])
                      }}
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
            {mode === 'select' && (
              <>
                <p className="linus-speech">Which PRs deserve a look?</p>
                {!preferences?.organization ? (
                  <p>
                    Choose your{' '}
                    <Link to="/settings" onClick={close}>
                      primary model in Settings
                    </Link>{' '}
                    first.
                  </p>
                ) : (
                  <>
                    <p className="muted linus-small">
                      Two independent reviews, then your primary model reconciles them. Up to 20 PRs
                      per review.
                    </p>
                    <div className="linus-selection-toolbar">
                      <button
                        onClick={() => setSelected(pulls.slice(0, 20).map((pull) => pull.url))}
                      >
                        Select all{pulls.length > 20 ? ' (first 20)' : ''}
                      </button>
                      <button onClick={() => setSelected([])}>Clear</button>
                      <span>{selected.length} selected</span>
                    </div>
                    <div className="linus-pull-picker">
                      {pulls.map((pull) => (
                        <label key={pull.url}>
                          <input
                            type="checkbox"
                            checked={selected.includes(pull.url)}
                            disabled={!selected.includes(pull.url) && selected.length >= 20}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, pull.url]
                                  : selected.filter((url) => url !== pull.url),
                              )
                            }
                          />
                          <span>
                            <small>
                              #{pull.number}
                              {pull.isDraft ? ' · Draft' : ''}
                            </small>
                            {pull.title}
                          </span>
                        </label>
                      ))}
                      {!pulls.length && <p className="muted">No open PRs to review.</p>}
                    </div>
                    <div className="linus-actions">
                      <Button
                        size="sm"
                        disabled={!selected.length || busy}
                        onClick={() => {
                          setMode('review')
                          setHiddenEvidenceTurn(turnKey)
                          void act(
                            'start',
                            selected.filter((url) => pulls.some((pull) => pull.url === url)),
                          )
                        }}
                      >
                        Review selected
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setMode('intro')}>
                        Back
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
            {reviewMode && (
              <>
                {active && (
                  <div className="linus-working" role="status">
                    <LoaderCircle size={15} className="animate-spin" />
                    <div>
                      <strong>Compiling opinions…</strong>
                      <span>{session.progress}</span>
                    </div>
                  </div>
                )}
                {session?.status === 'partial' && (
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
                {(session?.status === 'failed' || session?.status === 'cancelled') && (
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
                        {active ? ' so far' : ''}
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
                    {(turn.result.advice.limitations.length > 0 ||
                      turn.result.advice.disagreements.length > 0) && (
                      <details className="linus-caveats">
                        <summary>Limitations and disagreements</summary>
                        {[
                          ...turn.result.advice.limitations,
                          ...turn.result.advice.disagreements,
                        ].map((text, i) => (
                          <p key={i}>{text}</p>
                        ))}
                      </details>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setHiddenEvidenceTurn(evidence ? turnKey : undefined)}
                      >
                        <Maximize2 size={13} />
                        {evidence ? 'Hide evidence' : 'Show evidence'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={index >= turns.length - 1}
                        onClick={() => advance(index + 1)}
                      >
                        Next <ChevronRight size={14} />
                      </Button>
                    </div>
                    <div className="linus-copy-actions">
                      <button onClick={() => void copy(false)}>
                        <Copy size={13} /> Copy this PR
                      </button>
                      <button onClick={() => void copy(true)}>Copy all recommendations</button>
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
                  {active && (
                    <button disabled={busy} onClick={() => void act('cancel')}>
                      Cancel review
                    </button>
                  )}
                  {session?.status === 'partial' && (
                    <button disabled={busy} onClick={() => void act('cancel')}>
                      Cancel review
                    </button>
                  )}
                  {canSelect && (
                    <button
                      onClick={() => {
                        setMode('select')
                        setHiddenEvidenceTurn(turnKey)
                        setSelected([])
                      }}
                    >
                      Review other PRs
                    </button>
                  )}
                  <button onClick={close}>Close</button>
                </div>
              </>
            )}
            {loading && (
              <p className="muted" role="status">
                Loading saved review…
              </p>
            )}
            {error && (
              <p className="linus-error" role="alert">
                {error} <button onClick={reload}>Reconnect</button>
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
