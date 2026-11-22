import { groundingImpactLabels } from '../../../shared/domain/impact'
import type { StackBrief } from '../../../shared/domain/stackBrief'
import { layerMoved, movedReason } from '../../../shared/domain/stackBriefLayers'
import { briefCounts, fixKindSummary } from '../../../shared/domain/stackReviewView'
import { DecisionGroups } from './DecisionGroups'
import { LayerFixWorker } from './LayerFixWorker'
import { BriefNotes } from './BriefNotes'

export function StackBriefView({
  brief,
  fixGroups,
  sessionId,
}: {
  brief: StackBrief
  fixGroups: StackBrief['fixes']
  sessionId: string
}) {
  const { fixes } = briefCounts(brief)
  return (
    <>
      {brief.serious.length > 0 && <SeriousList items={brief.serious} />}
      <section className="stack-review-band">
        <h2>Needs your answer · {brief.decisions.length}</h2>
        <DecisionGroups decisions={brief.decisions} />
      </section>
      <section className="stack-review-band" hidden={!fixes}>
        <h2>Ready to fix · {fixes}</h2>
        <p className="stack-brief-detail">{fixKindSummary(brief)}</p>
        <p className="stack-brief-detail">
          Commits locally in an app-owned worktree. Pushes nothing.
        </p>
        {fixGroups.map(({ layer, items }) => (
          <details
            key={layer.number}
            className="stack-review-disclosure"
            hidden={!brief.fixes.some((group) => group.layer.number === layer.number)}
          >
            <summary>
              #{layer.number} {layer.title} · {items.length} {items.length === 1 ? 'fix' : 'fixes'}
            </summary>
            {layerMoved(layer) && <p className="stack-warning">{movedReason(layer)}</p>}
            <LayerFixWorker stack={sessionId} layer={layer} fixes={items} />
          </details>
        ))}
      </section>
      <BriefNotes brief={brief} />
    </>
  )
}

function SeriousList({ items }: { items: StackBrief['serious'] }) {
  return (
    <section className="stack-review-band">
      <h2>Serious consequences</h2>
      <p className="stack-brief-detail">
        Settle each before other work: fixed and checked, refuted with evidence, accepted as a risk
        with a reason, or assigned for investigation with an owner.
      </p>
      <ul className="stack-brief-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong> <code>{item.id}</code>
            <p>{item.consequence}</p>
            <p className="stack-brief-detail">
              {groundingImpactLabels[item.impact]} · {item.standing}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
