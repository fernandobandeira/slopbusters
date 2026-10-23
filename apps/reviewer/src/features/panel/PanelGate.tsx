import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  groundingOriginLabels,
  groundingResolutionLabels,
  groundingVerdictLabels,
  type GroundingState,
  type ResolvedEntry,
} from '../../../shared/domain/grounding'
import type { GateItem } from '../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { FindingText } from '../../components/FindingText'
import { PanelDestinations } from './PanelDestinations'
import { PanelProceed } from './PanelProceed'
import { usePanelGate } from './usePanelGate'

type Gate = ReturnType<typeof usePanelGate>

const settled = (entry: ResolvedEntry) => entry.resolution !== 'disputed'
const followUp = (entry: ResolvedEntry) =>
  entry.origin === 'preexisting' && ['legit', 'authorsCall'].includes(entry.verdict ?? '')

/**
 * How the gate groups entries: what to fix first, then what needs the author, then problems that
 * were there before this PR, then the rest.
 */
const groups: { title: string; open: boolean; matches: (entry: ResolvedEntry) => boolean }[] = [
  {
    title: 'Worth fixing',
    open: true,
    matches: (entry) => entry.verdict === 'legit' && settled(entry) && !followUp(entry),
  },
  {
    title: 'Questions for you',
    open: true,
    matches: (entry) => entry.verdict === 'authorsCall' && settled(entry) && !followUp(entry),
  },
  { title: 'The models disagree', open: true, matches: (entry) => !settled(entry) },
  {
    title: 'Needs evidence',
    open: true,
    matches: (entry) => !entry.verdict && settled(entry),
  },
  {
    title: 'Already there · follow-ups',
    open: true,
    matches: (entry) => followUp(entry) && settled(entry),
  },
  {
    title: 'Rejected',
    open: false,
    matches: (entry) =>
      Boolean(entry.verdict) &&
      !['legit', 'authorsCall'].includes(entry.verdict ?? '') &&
      settled(entry),
  },
]

/**
 * The author's decision before any fix: which grounded entries to fix, their answers and plans.
 * Nothing here changes the models' verdicts.
 */
export function PanelGate({
  session,
  result,
  replace,
  moved,
  onOpen,
}: {
  session: PanelSession
  result: PanelResult
  replace: (session: PanelSession) => void
  moved: boolean
  onOpen: (sessionId: string) => void
}) {
  const gate = usePanelGate(session, result, replace)
  const selected = gate.items.filter((item) => item.action.selected)
  const blocked = selected.length - gate.ready.length
  return (
    <section className="panel-gate" aria-label="Choose fixes">
      <p className="muted panel-grounding-counts">
        {gate.ready.length} ready to fix{blocked ? ` · ${String(blocked)} blocked` : ''}
      </p>
      {groups.map((group) => {
        const items = gate.items.filter((item) => group.matches(item.entry))
        if (!items.length) return null
        return (
          <details key={group.title} className="finding-notes" open={group.open}>
            <summary>
              {group.title} · {items.length}
            </summary>
            <ul className="panel-gate-list">
              {items.map((item) => (
                <GateRow key={item.entry.id} item={item} gate={gate} grounding={result.grounding} />
              ))}
            </ul>
          </details>
        )
      })}
      <PanelProceed
        session={session}
        result={result}
        gate={gate}
        replace={replace}
        moved={moved}
        onOpen={onOpen}
      />
      <PanelDestinations
        session={session}
        result={result}
        ready={gate.ready}
        replace={replace}
        onOpen={onOpen}
      />
      {gate.error && <p role="alert">{gate.error}</p>}
    </section>
  )
}

function GateRow({
  item,
  gate,
  grounding,
}: {
  item: GateItem
  gate: Gate
  grounding?: GroundingState
}) {
  const { entry, action } = item
  return (
    <li className="panel-gate-item">
      <label className="panel-gate-choice">
        <input
          type="checkbox"
          checked={action.selected}
          disabled={!entry.verdict}
          onChange={(event) => {
            gate.choose(entry.id, { selected: event.target.checked })
          }}
        />
        <strong>{entryTitle(entry, grounding)}</strong>
      </label>
      <p className="finding-severity">
        {entry.verdict ? groundingVerdictLabels[entry.verdict] : 'No verdict yet'} ·{' '}
        {groundingResolutionLabels[entry.resolution]}
        {entry.origin && ` · ${groundingOriginLabels[entry.origin]}`}
      </p>
      <FindingText>{entry.reason}</FindingText>
      {entry.question && <AnswerField item={item} gate={gate} />}
      {entry.resolution === 'disputed' && <PositionChoice item={item} gate={gate} />}
      {action.selected && <PlanField item={item} gate={gate} />}
      {item.problem && (
        <p className="panel-gate-problem" role="status">
          {item.problem}
        </p>
      )}
    </li>
  )
}

function AnswerField({ item, gate }: { item: GateItem; gate: Gate }) {
  return (
    <label className="panel-gate-field">
      <span>{item.entry.question}</span>
      <textarea
        rows={2}
        maxLength={2000}
        value={item.action.answer ?? ''}
        placeholder="Your answer"
        onChange={(event) => {
          gate.type(item.entry.id, { answer: event.target.value })
        }}
        onBlur={gate.commit}
      />
    </label>
  )
}

function PositionChoice({ item, gate }: { item: GateItem; gate: Gate }) {
  const other = item.entry.other?.entries[0]
  const options = [
    { value: 'list' as const, label: verdictText(item.entry.verdict), reason: item.entry.reason },
    { value: 'other' as const, label: verdictText(other?.verdict), reason: other?.reason },
  ]
  return (
    <fieldset className="panel-gate-field">
      <legend>Which position do you take?</legend>
      {options.map((option) => (
        <label key={option.value} className="panel-gate-choice">
          <input
            type="radio"
            name={`position-${item.entry.id}`}
            checked={item.action.choice === option.value}
            onChange={() => {
              gate.choose(item.entry.id, { choice: option.value })
            }}
          />
          <span>
            {option.value === 'list' ? 'The final list' : 'The other model'}: {option.label}
            {option.reason ? ` — ${option.reason}` : ''}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function PlanField({ item, gate }: { item: GateItem; gate: Gate }) {
  const { entry, action } = item
  const planning = gate.planning === entry.id
  return (
    <label className="panel-gate-field">
      <span>
        Plan
        {action.planBy === 'author' ? ' · yours' : action.planBy === 'planner' ? ' · drafted' : ''}
      </span>
      <textarea
        rows={3}
        maxLength={2000}
        value={action.planBy === 'author' ? (action.plan ?? '') : (item.plan ?? '')}
        placeholder="What the fix should change"
        onChange={(event) => {
          gate.type(entry.id, { plan: event.target.value, planBy: 'author' })
        }}
        onBlur={gate.commit}
      />
      {entry.verdict && (
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(gate.planning) || (entry.verdict === 'authorsCall' && !action.answer)}
          onClick={() => {
            gate.plan(entry.id)
          }}
        >
          {planning && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
          {planning ? 'Drafting a plan…' : 'Ask the models for a plan'}
        </Button>
      )}
    </label>
  )
}

function verdictText(verdict: ResolvedEntry['verdict']) {
  return verdict ? groundingVerdictLabels[verdict] : 'No verdict'
}

/** The lead source's title: the entry stands for that finding and any it merged. */
function entryTitle(entry: ResolvedEntry, grounding?: GroundingState) {
  const lead = grounding?.candidates.find((candidate) => entry.sources.includes(candidate.key))
  const merged = entry.sources.length > 1 ? ` (+${String(entry.sources.length - 1)})` : ''
  return `${lead?.finding.title ?? entry.id}${merged}`
}
