import { useState } from 'react'
import type { BriefAnswer } from '../../../shared/domain/stackBrief'
import type { BriefDecision } from '../../../shared/domain/stackDecisions'
import { Button } from '~/components/ui/button'
import type { StackRecordActions } from './useStackRecords'

export function DecisionControls({
  decision,
  revision,
  stale,
  defaultOption,
  actions,
}: {
  decision: BriefDecision
  revision: number
  stale: boolean
  defaultOption?: string
  actions: StackRecordActions
}) {
  const [note, setNote] = useState('')
  const identity = { decisionId: decision.id, expectedRevision: revision }
  const optionalNote = note.trim() || undefined
  return (
    <fieldset disabled={actions.busy} className="stack-review-controls">
      {stale && (
        <p className="stack-warning">
          A relevant layer moved. A saved answer will need rechecking.
        </p>
      )}
      <div className="stack-review-options">
        {decision.options.map((option) => (
          <div key={option.id} className="stack-review-option">
            <Button
              size="sm"
              variant={option.id === defaultOption ? 'secondary' : 'outline'}
              onClick={() =>
                void actions.answer({
                  ...identity,
                  answer: { state: 'chosen', optionId: option.id, note: optionalNote },
                })
              }
            >
              {optionLabel(option)}
            </Button>
            <div>
              {option.id === defaultOption && (
                <span className="stack-review-recommendation">Default</span>
              )}
              {option.detail && <p>{option.detail}</p>}
              {option.reply && (
                <p className="stack-brief-detail">Reply if chosen: {option.reply}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <PrivateNote note={note} setNote={setNote} />
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void actions.answer({
            ...identity,
            answer: { state: 'leftOpen', note: optionalNote },
          })
        }
      >
        Leave open
      </Button>
    </fieldset>
  )
}

function PrivateNote({ note, setNote }: { note: string; setNote: (note: string) => void }) {
  const [showNote, setShowNote] = useState(false)
  return showNote ? (
    <label className="stack-review-field">
      Private note (optional)
      <textarea
        rows={2}
        maxLength={12000}
        value={note}
        onChange={(event) => {
          setNote(event.target.value)
        }}
      />
    </label>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        setShowNote(true)
      }}
    >
      Add a note
    </Button>
  )
}

function optionLabel({ id, label, detail, change }: BriefDecision['options'][number]) {
  if (!change || detail !== change.plan) return label
  if (id === 'change') return 'Follow the plan'
  if (id.startsWith('layer-')) return `Follow the plan on PR #${change.layer}`
  return `Follow the plan · ${label}`
}

export function AnsweredCard({
  item,
  actions,
}: {
  item: BriefAnswer
  actions: StackRecordActions
}) {
  const { decision, option, record, manual, recheck, revision, confirmableAt } = item
  const { answer } = record
  const identity = { decisionId: decision.id, expectedRevision: revision }
  return (
    <article className="stack-review-card">
      <h3>{decision.title}</h3>
      <p>
        <strong>{option ? optionLabel(option) : 'Left open'}</strong> · PR #{decision.layer}
      </p>
      {revision === 0 && (
        <p className="stack-brief-detail">Carried over from an earlier stack review</p>
      )}
      {answer.note && <p>Private note: {answer.note}</p>}
      {answer.state === 'chosen' && answer.reply && <p>Reply ready: {answer.reply}</p>}
      {manual && !recheck && <p>Manual work: {option?.change?.plan || option?.label}</p>}
      {recheck && (
        <p className="stack-warning">Recheck this answer against the current layer revisions.</p>
      )}
      <div className="stack-review-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={actions.busy}
          onClick={() => void actions.reopen(identity)}
        >
          Reopen
        </Button>
        {confirmableAt && (
          <Button
            size="sm"
            disabled={actions.busy}
            onClick={() =>
              void actions.answer({
                ...identity,
                confirm: confirmableAt,
                answer,
              })
            }
          >
            Confirm for current revisions
          </Button>
        )}
      </div>
    </article>
  )
}
