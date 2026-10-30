import { Popover } from '@base-ui/react/popover'
import { LoaderCircle, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import type { Teammate } from '../../../shared/domain/teammates'
import type { Provider } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'
import { ReviewerFace } from '../../components/ReviewerFace'
import { personaFaceSrc } from '../../lib/reviewerFaces'
import { CandidateRow } from './CandidateRow'
import {
  panelCandidates,
  resolveChoices,
  savedLinusFirst,
  savedPanelSelection,
  saveLinusFirst,
  savePanelSelection,
  toggleProvider,
  toggleReviewer,
  type Candidate,
  type PanelChoice,
} from './panelSelection'
import './panel.css'

/** "Ask the panel": choose reviewers for this PR and start them. Nothing runs until the click. */
export function PanelPicker({
  repository,
  pull,
  provider,
  onOpen,
  onLinus,
  openOnMount = false,
  onClose,
}: {
  repository: string
  pull: { url: string; number: number }
  /** The primary model's provider; teammates need their skill installed for it. */
  provider?: Provider
  onOpen: (sessionId: string) => void
  /** Linus went first instead: the panel follows his verdict. */
  onLinus?: (sessionId: string) => void
  openOnMount?: boolean
  onClose?: () => void
}) {
  const start = usePanelStart({ repository, url: pull.url, onOpen, onLinus })
  return (
    <PanelPickerPopover
      label={`Ask the review panel about PR #${String(pull.number)}`}
      subject={`PR #${String(pull.number)}`}
      provider={provider}
      start={start}
      openOnMount={openOnMount}
      onClose={onClose}
    />
  )
}

/** The "Ask the panel" button and its picker; `start` decides what the chosen reviewers review. */
export function PanelPickerPopover({
  label,
  subject,
  provider,
  start,
  openOnMount = false,
  onClose,
  disabled = false,
}: {
  label: string
  subject: string
  provider?: Provider
  start: PanelStart
  openOnMount?: boolean
  onClose?: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(openOnMount)
  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) onClose?.()
  }
  const teammates = useApiQuery(routes.listTeammates, {}, { enabled: open })
  const candidates = panelCandidates(teammates.data?.teammates ?? [])
  const [selected, setSelected] = useState(savedPanelSelection)
  const chosen = provider ? resolveChoices(selected, candidates, provider) : []
  function choose(next: Required<PanelChoice>[]) {
    setSelected(next)
    savePanelSelection(next)
  }
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger
        render={<Button size="sm" variant="outline" />}
        aria-label={label}
        disabled={disabled}
      >
        <Users size={13} aria-hidden="true" />
        Ask the panel
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="panel-picker-positioner"
        >
          <Popover.Popup className="panel-picker">
            <PickerBody
              subject={subject}
              candidates={candidates}
              teammates={teammates}
              chosen={chosen}
              onToggle={(candidate) => {
                if (provider) choose(toggleReviewer(chosen, candidate, provider))
              }}
              onToggleProvider={(id, picked) => {
                choose(toggleProvider(chosen, id, picked))
              }}
              provider={provider}
              start={start}
              onStarted={() => {
                // Opening the new panel already clears the request that opened the picker.
                setOpen(false)
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** What a panel start reports: whether it started, while it starts, and why it did not. */
export interface PanelStart {
  /** Start the reviewers, or Linus first so that only the PRs he would keep as one go on. */
  run: (reviewers: Required<PanelChoice>[], linusFirst: boolean) => Promise<boolean>
  starting: boolean
  error: string
  /** Whether Linus can go first here. */
  linusFirst?: boolean
}

/** Pick the reviewers and their providers, then start them; shared by one PR and several. */
function PickerBody({
  subject,
  candidates,
  teammates,
  chosen,
  onToggle,
  onToggleProvider,
  provider,
  start,
  onStarted,
}: {
  /** What the panel reviews, such as "PR #12" or "4 PRs". */
  subject: string
  candidates: Candidate[]
  teammates: { data?: { teammates: Teammate[] }; loading: boolean; error?: string }
  chosen: Required<PanelChoice>[]
  onToggle: (candidate: Candidate) => void
  onToggleProvider: (id: Candidate['id'], provider: Provider) => void
  provider?: Provider
  start: PanelStart
  onStarted: () => void
}) {
  const [linusFirst, setLinusFirst] = useState(savedLinusFirst)
  const askLinus = Boolean(start.linusFirst) && linusFirst
  const chooseLinusFirst = (next: boolean) => {
    setLinusFirst(next)
    saveLinusFirst(next)
  }
  return (
    <>
      <Popover.Title className="panel-picker-title">Who should review {subject}?</Popover.Title>
      <Popover.Description className="muted">
        Each reviewer runs on Codex, Claude, or both, then Claude and Codex take turns checking
        their findings against the code.
      </Popover.Description>
      <div role="group" aria-label="Reviewers" className="panel-candidates">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            teammates={teammates.data?.teammates}
            providers={chosen.find((choice) => choice.id === candidate.id)?.providers ?? []}
            onToggle={() => {
              onToggle(candidate)
            }}
            onToggleProvider={(picked) => {
              onToggleProvider(candidate.id, picked)
            }}
          />
        ))}
        {teammates.loading && <p className="muted">Loading teammates…</p>}
        {teammates.error && <p role="alert">{teammates.error}</p>}
      </div>
      <Link className="panel-manage" to="/settings">
        Add or edit teammates in Settings
      </Link>
      {start.linusFirst && <LinusFirstChoice checked={linusFirst} onChange={chooseLinusFirst} />}
      {!provider && <p className="muted">Choose your primary model in Settings first.</p>}
      {start.error && (
        <p role="alert" className="error-text">
          {start.error}
        </p>
      )}
      <Button
        size="sm"
        disabled={!provider || !chosen.length || start.starting}
        onClick={() => {
          void start.run(chosen, askLinus).then((started) => {
            if (started) onStarted()
          })
        }}
      >
        {start.starting && <LoaderCircle size={13} className="animate-spin" />}
        {askLinus ? `Ask Linus, then ${startLabel(chosen).toLowerCase()}` : startLabel(chosen)}
      </Button>
    </>
  )
}

/** Whether Linus decides on a split before the panel starts. */
function LinusFirstChoice({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="panel-linus-first">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <ReviewerFace name="Linus" src={personaFaceSrc('linus', 'neutral')} size={28} />
      <span className="panel-candidate-text">
        <strong>Ask Linus first</strong>
        <span className="muted">
          He decides whether each PR should be split. One he would keep goes straight to the panel;
          one he would split waits for you.
        </span>
      </span>
    </label>
  )
}

/** "Review with 3 reviewers", or with the number of runs when some run on both providers. */
function startLabel(chosen: Required<PanelChoice>[]) {
  const runs = chosen.reduce((total, choice) => total + choice.providers.length, 0)
  const reviewers = `${String(chosen.length)} ${chosen.length === 1 ? 'reviewer' : 'reviewers'}`
  return runs > chosen.length
    ? `Review with ${reviewers}, ${String(runs)} runs`
    : `Review with ${reviewers}`
}

/** Start the panel; when another panel is in the way, open that one and say why. */
function usePanelStart({
  repository,
  url,
  onOpen,
  onLinus,
}: {
  repository: string
  url: string
  onOpen: (sessionId: string) => void
  onLinus?: (sessionId: string) => void
}): PanelStart {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  async function run(reviewers: PanelChoice[], linusFirst: boolean): Promise<boolean> {
    setStarting(true)
    setError('')
    try {
      if (linusFirst && onLinus) {
        const linus = await call(routes.startLinus, {
          body: { repository, urls: [url], thenPanel: { reviewers } },
        })
        onLinus(linus.id)
        return true
      }
      const session = await call(routes.startPanel, {
        body: { repository, urls: [url], reviewers },
      })
      onOpen(session.id)
      return true
    } catch (cause) {
      const blocking = await call(routes.latestPanel, { query: { repository, url } }).catch(
        () => undefined,
      )
      if (blocking?.session && blocksNewReview(blocking.session)) onOpen(blocking.session.id)
      setError(message(cause))
      return false
    } finally {
      setStarting(false)
    }
  }
  return { run, starting, error, linusFirst: Boolean(onLinus) }
}
