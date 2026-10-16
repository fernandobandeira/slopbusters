import { Popover } from '@base-ui/react/popover'
import { Check, LoaderCircle, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import {
  builtInReviewerIds,
  builtInReviewers,
  teammateReviewerId,
  type ReviewerId,
} from '../../../shared/domain/panel'
import { blocksNewReview } from '../../../shared/domain/reviewSession'
import {
  availabilityLabels,
  installedFor,
  skillAvailability,
  type Teammate,
} from '../../../shared/domain/teammates'
import type { Provider } from '../../../shared/domain/types'
import { ReviewerFace } from '../../components/ReviewerFace'
import { call, message } from '../../lib/api'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'
import { useApiQuery } from '../../lib/useApiQuery'
import { savedPanelSelection, savePanelSelection } from './panelSelection'
import './panel.css'

interface Candidate {
  id: ReviewerId
  name: string
  description?: string
  /** Why the reviewer cannot run now, such as a skill installed only for the other provider. */
  unavailable?: string
}

/** "Ask the panel": choose reviewers for this PR and start them. Nothing runs until the click. */
export function PanelPicker({
  repository,
  pull,
  provider,
  onOpen,
}: {
  repository: string
  pull: { url: string; number: number }
  /** The primary model's provider; teammates need their skill installed for it. */
  provider?: Provider
  onOpen: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const teammates = useApiQuery(routes.listTeammates, {}, { enabled: open })
  const candidates = panelCandidates(teammates.data?.teammates ?? [], provider)
  const [selected, setSelected] = useState(savedPanelSelection)
  const chosen = selected.filter((id) =>
    candidates.some((candidate) => candidate.id === id && !candidate.unavailable),
  )
  const start = usePanelStart({ repository, url: pull.url, onOpen })
  function toggle(id: ReviewerId) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
    setSelected(next)
    savePanelSelection(next)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
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
              toggle={toggle}
              provider={provider}
              start={start}
              onStarted={() => {
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
  toggle,
  provider,
  start,
  onStarted,
}: {
  number: number
  candidates: Candidate[]
  teammates: { data?: { teammates: Teammate[] }; loading: boolean; error?: string }
  chosen: ReviewerId[]
  toggle: (id: ReviewerId) => void
  provider?: Provider
  start: ReturnType<typeof usePanelStart>
  onStarted: () => void
}) {
  return (
    <>
      <Popover.Title className="panel-picker-title">Who should review PR #{number}?</Popover.Title>
      <Popover.Description className="muted">
        Each reviewer reviews on your primary model, then a judge checks their findings against the
        code.
      </Popover.Description>
      <div role="group" aria-label="Reviewers" className="panel-candidates">
        {candidates.map((candidate) => (
          <CandidateToggle
            key={candidate.id}
            candidate={candidate}
            teammates={teammates.data?.teammates}
            checked={chosen.includes(candidate.id)}
            onToggle={() => {
              toggle(candidate.id)
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
        Review with {chosen.length} {chosen.length === 1 ? 'reviewer' : 'reviewers'}
      </Button>
    </>
  )
}

function CandidateToggle({
  candidate,
  teammates,
  checked,
  onToggle,
}: {
  candidate: Candidate
  teammates?: Teammate[]
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="panel-candidate"
      disabled={Boolean(candidate.unavailable)}
      onClick={onToggle}
    >
      <ReviewerFace
        name={candidate.name}
        src={reviewerFaceSrc(candidate.id, 'neutral', teammates)}
        size={32}
      />
      <span className="panel-candidate-text">
        <strong>{candidate.name}</strong>
        <span className="muted">{candidate.unavailable ?? candidate.description}</span>
      </span>
      <span className="panel-candidate-check" aria-hidden="true">
        {checked && <Check size={14} />}
      </span>
    </button>
  )
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
  async function run(reviewers: ReviewerId[]): Promise<boolean> {
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

/** Uncle Bob and Rules first, then every teammate; teammates not installed for the provider are off. */
export function panelCandidates(teammates: readonly Teammate[], provider?: Provider): Candidate[] {
  return [
    ...builtInReviewerIds.map((id) => ({
      id,
      name: builtInReviewers[id].name,
      description: builtInReviewers[id].description,
    })),
    ...teammates.map((teammate) => {
      const availability = skillAvailability(teammate.locations)
      const ready = provider
        ? installedFor(teammate.locations, provider)
        : availability !== 'missing'
      return {
        id: teammateReviewerId(teammate.id),
        name: teammate.name,
        description: teammate.title ?? teammate.skill,
        ...(ready ? {} : { unavailable: `${teammate.skill}: ${availabilityLabels[availability]}` }),
      }
    }),
  ]
}
