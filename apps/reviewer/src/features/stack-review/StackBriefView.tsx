import { layerMoved, movedReason } from '../../../shared/domain/stackBriefLayers'
import { Button } from '~/components/ui/button'
import { useStackFixSelection, type StackFixSelection } from './useStackFixSelection'
import { answerLabel } from '../../../shared/domain/stackReviewRecords'
import { AnsweredCard } from './DecisionControls'
import { SeriousClaims } from './SeriousClaims'
import type { StackRecordActions } from './useStackRecords'
import type { StackBrief } from '../../../shared/domain/stackBrief'
import { briefCounts, fixKindSummary } from '../../../shared/domain/stackReviewView'
import { DecisionGroups } from './DecisionGroups'
import { LayerFixWorker } from './LayerFixWorker'
import { BriefNotes } from './BriefNotes'

export function StackBriefView({
  brief,
  fixGroups,
  sessionId,
  actions,
}: {
  brief: StackBrief
  fixGroups: StackBrief['fixes']
  sessionId: string
  actions: StackRecordActions
}) {
  const { answered } = briefCounts(brief)
  const selection = useStackFixSelection(sessionId, brief.fixes)
  return (
    <>
      {brief.fixes.length > 0 && <FixToolbar selection={selection} />}
      {selection.error && <p role="alert">{selection.error}</p>}
      {brief.serious.length > 0 && (
        <SeriousClaims
          items={brief.serious}
          fixes={fixGroups}
          selection={selection}
          actions={actions}
        />
      )}
      <section className="stack-review-band">
        <h2>Needs your answer · {brief.decisions.length}</h2>
        <DecisionGroups brief={brief} actions={actions} />
      </section>
      {answered > 0 && (
        <section className="stack-review-band">
          <h2>Answered · {answered}</h2>
          {brief.review?.answered.map((item) => (
            <AnsweredCard key={item.decision.id} item={item} actions={actions} />
          ))}
        </section>
      )}
      <FixGroups brief={brief} fixGroups={fixGroups} sessionId={sessionId} selection={selection} />
      {Boolean(brief.review?.history.length) && (
        <details className="stack-review-band">
          <summary>Decision history · {brief.review?.history.length}</summary>
          <ul className="stack-brief-list">
            {brief.review?.history.map((record) => (
              <li key={`${record.sessionId}:${record.itemId}`}>
                <strong>{record.snapshot.title}</strong> · {answerLabel(record)}
                <p className="stack-brief-detail">
                  PR #{record.sourcePr} · {record.updatedAt.slice(0, 10)}
                </p>
                {record.answer?.note && <p>Private note: {record.answer.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <BriefNotes brief={brief} />
    </>
  )
}

function FixToolbar({ selection }: { selection: StackFixSelection }) {
  return (
    <div className="stack-review-fix-toolbar">
      <Button disabled={selection.disabled} onClick={() => void selection.apply()}>
        Fix selected ({selection.selected.length})
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={selection.locked || !selection.available.length}
        onClick={selection.toggleAll}
      >
        {selection.selected.length ? 'Clear selection' : 'Select all'}
      </Button>
      <span>Commits locally on each selected PR.</span>
    </div>
  )
}

function FixGroups({
  brief,
  fixGroups,
  sessionId,
  selection,
}: {
  brief: StackBrief
  fixGroups: StackBrief['fixes']
  sessionId: string
  selection: StackFixSelection
}) {
  const { fixes } = briefCounts(brief)
  return (
    <section className="stack-review-band" hidden={!brief.fixes.length}>
      <h2>Ready to fix · {fixes}</h2>
      <p className="stack-brief-detail">{fixKindSummary(brief)}</p>
      <p className="stack-brief-detail">
        Commits locally in an app-owned worktree. Pushes nothing.
      </p>
      {fixGroups.map(({ layer, items }) => {
        const ready = items.filter(({ applied }) => !applied).length
        return (
          <details
            key={layer.number}
            open
            className="stack-review-disclosure"
            hidden={!brief.fixes.some((group) => group.layer.number === layer.number)}
          >
            <summary>
              #{layer.number} {layer.title} · {ready} {ready === 1 ? 'fix' : 'fixes'}
            </summary>
            {layerMoved(layer) && <p className="stack-warning">{movedReason(layer)}</p>}
            <LayerFixWorker
              key={selection.revision}
              selection={selection}
              stack={sessionId}
              layer={layer}
              fixes={items}
            />
          </details>
        )
      })}
    </section>
  )
}
