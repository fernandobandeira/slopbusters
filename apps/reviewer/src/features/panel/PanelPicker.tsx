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
import { CandidateRow } from './CandidateRow'
import {
  panelCandidates,
  resolveChoices,
  savedPanelSelection,
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
  openOnMount = false,
  onClose,
}: {
  repository: string
  pull: { url: string; number: number }
  /** The primary model's provider; teammates need their skill installed for it. */
  provider?: Provider
  onOpen: (sessionId: string) => void
  openOnMount?: boolean
  onClose?: () => void
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
  const start = usePanelStart({ repository, url: pull.url, onOpen })
  function choose(next: Required<PanelChoice>[]) {
    setSelected(next)
    savePanelSelection(next)
  }
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger
        render={<Button size="sm" variant="outline" />}
        aria-label={`Ask the review panel about PR #${String(pull.number)}`}
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
              number={pull.number}
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

function PickerBody({
  number,
  candidates,
  teammates,
  chosen,
  onToggle,
  onToggleProvider,
  provider,
  start,
  onStarted,
}: {
  number: number
  candidates: Candidate[]
  teammates: { data?: { teammates: Teammate[] }; loading: boolean; error?: string }
  chosen: Required<PanelChoice>[]
  onToggle: (candidate: Candidate) => void
  onToggleProvider: (id: Candidate['id'], provider: Provider) => void
  provider?: Provider
  start: ReturnType<typeof usePanelStart>
  onStarted: () => void
}) {
  return (
    <>
      <Popover.Title className="panel-picker-title">Who should review PR #{number}?</Popover.Title>
      <Popover.Description className="muted">
        Each reviewer runs on Codex, Claude, or both, then a judge on your primary model checks
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
          void start.run(chosen).then((started) => {
            if (started) onStarted()
          })
        }}
      >
        {start.starting && <LoaderCircle size={13} className="animate-spin" />}
        {startLabel(chosen)}
      </Button>
    </>
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
}: {
  repository: string
  url: string
  onOpen: (sessionId: string) => void
}) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  async function run(reviewers: PanelChoice[]): Promise<boolean> {
    setStarting(true)
    setError('')
    try {
      const session = await call(routes.startPanel, {
        body: { repository, urls: [url], reviewers },
      })
      onOpen(session.id)
      return true
    } catch (cause) {
      const blocking = await call(routes.latestPanel, { query: { repository } }).catch(
        () => undefined,
      )
      if (blocking?.session && blocksNewReview(blocking.session)) onOpen(blocking.session.id)
      setError(message(cause))
      return false
    } finally {
      setStarting(false)
    }
  }
  return { run, starting, error }
}
