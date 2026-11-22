import { groundingKindLabels } from '../../../shared/domain/grounding'
import { seatReviewer } from '../../../shared/domain/panel'
import type { BriefDecision } from '../../../shared/domain/stackDecisions'
import { groupDecisions } from '../../../shared/domain/stackReviewView'

export function DecisionGroups({ decisions }: { decisions: BriefDecision[] }) {
  return groupDecisions(decisions).map((group) => (
    <details key={group.id} className="stack-review-disclosure" open={!group.hasDefault}>
      <summary>
        {group.label} · {group.decisions.length}
        {!group.hasDefault && <span className="stack-review-group-default">No default</span>}
      </summary>
      {group.decisions.map((decision) => (
        <DecisionCard key={decision.id} decision={decision} />
      ))}
    </details>
  ))
}

function DecisionCard({ decision }: { decision: BriefDecision }) {
  const { layer, group, title, kind, cost, reason, evidence, options, crossLayerQuestion } =
    decision
  const reviewerCount = new Set(evidence.flatMap((entry) => entry.raisedBy.map(seatReviewer))).size
  const entry = evidence[0]
  const fullQuestion = group === 'openQuestion' ? entry?.question : decision.question
  const meta = [
    `PR #${layer}`,
    kind && groundingKindLabels[kind],
    cost,
    reviewerCount > 0 &&
      `Raised by ${reviewerCount} ${reviewerCount === 1 ? 'reviewer' : 'reviewers'}`,
    evidence.some((item) => item.reverses) && 'An earlier round already asked',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <article className="stack-review-card">
      <h3>{title}</h3>
      <p className="stack-brief-detail">{meta}</p>
      <p>{reason}</p>
      {crossLayerQuestion && <p>{crossLayerQuestion}</p>}
      {group === 'crossLayer' && decision.contested && !evidence.length && (
        <p>The second model did not approve this proposal.</p>
      )}
      <ul className="stack-review-options">
        {options.map(({ id, label, detail, recommended }) => (
          <li key={id}>
            <strong>{label}</strong>
            {recommended && <span className="stack-review-recommendation">Recommended</span>}
            {detail && <p>{detail}</p>}
          </li>
        ))}
      </ul>
      <details className="stack-review-evidence">
        <summary>Evidence and history</summary>
        {fullQuestion && fullQuestion !== crossLayerQuestion && (
          <p>Full question: {fullQuestion}</p>
        )}
        {evidence.map((item) => (
          <Evidence key={item.id} item={item} showQuestion={item.question !== fullQuestion} />
        ))}
      </details>
    </article>
  )
}

function Evidence({
  item,
  showQuestion,
}: {
  item: BriefDecision['evidence'][number]
  showQuestion: boolean
}) {
  const { reverses } = item
  return (
    <div className="stack-review-evidence-item">
      <p>
        <code>{item.id}</code> · {item.title}
      </p>
      {item.raisedBy.length > 0 && <p>Raised by {item.raisedBy.join(', ')}</p>}
      {showQuestion && item.question && <p>Original question: {item.question}</p>}
      {reverses && (
        <>
          <p>
            Round of {reverses.request.round} · {reverses.request.title}
          </p>
          <p>{reverses.request.plan}</p>
          <p>The check found: {reverses.reason}</p>
        </>
      )}
      {item.evidence.length > 0 && (
        <ul className="stack-brief-list">
          {item.evidence.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
