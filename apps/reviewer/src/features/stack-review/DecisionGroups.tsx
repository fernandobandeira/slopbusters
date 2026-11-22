import { Button } from '~/components/ui/button'
import type { StackBrief } from '../../../shared/domain/stackBrief'
import { DecisionControls } from './DecisionControls'
import type { StackRecordActions } from './useStackRecords'
import { groundingKindLabels } from '../../../shared/domain/grounding'
import { seatReviewer } from '../../../shared/domain/panel'
import type { BriefDecision } from '../../../shared/domain/stackDecisions'
import { groupDecisions } from '../../../shared/domain/stackReviewView'

export function DecisionGroups({
  brief,
  actions,
}: {
  brief: StackBrief
  actions: StackRecordActions
}) {
  return groupDecisions(brief).map((group) => {
    const { defaults } = group
    const label = group.id === 'predicted' ? 'Keep the code, replies ready' : defaults[0]?.label
    return (
      <details
        key={group.id}
        className="stack-review-disclosure"
        open={defaults.length < group.decisions.length}
      >
        <summary>
          {group.label} · {group.decisions.length}
          {!defaults.length && <span className="stack-review-group-default">No default</span>}
        </summary>
        {defaults.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={actions.busy}
            onClick={() =>
              void actions.bulk(
                defaults.map(({ decisionId, expectedRevision, optionId }) => ({
                  decisionId,
                  expectedRevision,
                  optionId,
                })),
              )
            }
          >
            {label} · {defaults.length}
          </Button>
        )}
        {group.decisions.map((decision) => (
          <DecisionCard key={decision.id} decision={decision}>
            <DecisionControls
              decision={decision}
              revision={brief.review?.pending.get(decision.id)?.revision ?? 0}
              stale={brief.review?.pending.get(decision.id)?.stale ?? false}
              defaultOption={
                defaults.find(({ decisionId }) => decisionId === decision.id)?.optionId
              }
              actions={actions}
            />
          </DecisionCard>
        ))}
      </details>
    )
  })
}

function DecisionCard({
  decision,
  children,
}: {
  decision: BriefDecision
  children: React.ReactNode
}) {
  const { layer, group, title, kind, cost, reason, evidence, crossLayerQuestion } = decision
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
      {children}
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
