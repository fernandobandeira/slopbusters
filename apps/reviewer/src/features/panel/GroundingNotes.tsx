import { dispositionLabels, triage } from '../../../shared/domain/triage'
import {
  groundingKindLabels,
  groundingOriginLabels,
  groundingResolutionLabels,
  groundingVerdictLabels,
  groundingVerdicts,
  type GroundedEntry,
  type GroundingState,
  type ResolvedEntry,
} from '../../../shared/domain/grounding'
import type { PanelReviewer } from '../../../shared/domain/panel'
import type { PanelResult } from '../../../shared/domain/panelSession'
import { FindingText } from '../../components/FindingText'
import { FollowupAction } from './PanelFollowups'
import { reviewerName } from './PanelFaces'

/** What grounding decided about one finding: its verdict, whether both models agree, and why. */
export function GroundingVerdict({ result, id }: { result: PanelResult; id: string }) {
  const entry = result.grounding?.resolved?.find((item) => item.id === id)
  if (!entry) return null
  const decision = triage(entry)
  return (
    <div className="panel-grounding">
      <p className="finding-severity">
        {dispositionLabels[decision.disposition]}: {decision.reason}
      </p>
      <p className="finding-severity">
        {entry.kind && `${groundingKindLabels[entry.kind]} · `}
        {entry.effort && `${entry.effort} change · `}
        {verdictLabel(entry)} · {groundingResolutionLabels[entry.resolution]}
        {entry.origin && ` · ${groundingOriginLabels[entry.origin]}`}
      </p>
      <FollowupAction result={result} id={id} />
      <FindingText>{entry.reason}</FindingText>
      <EntryDetails entry={entry} marks={markDetails(result, entry)} />
      {entry.other && <OtherPosition other={entry.other} />}
    </div>
  )
}

/** What the consistency check found: the earlier request it would undo, the finding it opposes. */
function markDetails(result: PanelResult, entry: ResolvedEntry): Detail[] {
  const { reverses, opposes } = entry
  const details: Detail[] = []
  if (reverses) {
    const request = result.grounding?.earlier?.requests.find(
      (item) => item.key === reverses.earlier,
    )
    const asked = request
      ? `${request.entry} from the round of ${request.round}, "${request.title}": ${request.plan} `
      : ''
    details.push(['Would undo an earlier request', `${asked}${reverses.reason}`])
  }
  if (opposes) {
    const title = (id: string) =>
      result.advice.findings.find((finding) => finding.id === id)?.title ?? id
    const others = opposes.entries.map(title).join(', ')
    details.push(['Another finding asks for the opposite', `${others}: ${opposes.reason}`])
  }
  return details
}

type Detail = readonly [string, string | undefined]

function EntryDetails({ entry, marks }: { entry: GroundedEntry; marks: Detail[] }) {
  const details: Detail[] = [
    ...marks,
    ['Plan', entry.plan],
    ['Question for the author', entry.question],
    ['Evidence needed', entry.missing],
  ]
  return (
    <>
      {details.map(
        ([label, text]) =>
          text && (
            <div className="finding-suggestion" key={label}>
              <h3>{label}</h3>
              <FindingText>{text}</FindingText>
            </div>
          ),
      )}
      {entry.evidence.length > 0 && (
        <p className="muted">
          Evidence:{' '}
          {entry.evidence.map((reference, index) => (
            <span key={reference}>
              {index > 0 && ', '}
              <code>{reference}</code>
            </span>
          ))}
        </p>
      )}
    </>
  )
}

function OtherPosition({ other }: { other: NonNullable<ResolvedEntry['other']> }) {
  return (
    <details className="finding-notes">
      <summary>What the other model held</summary>
      <ul>
        {other.entries.map((entry) => (
          <li key={entry.id}>
            <strong>{verdictLabel(entry)}</strong>
            <FindingText>{entry.reason}</FindingText>
          </li>
        ))}
        {other.objections.map((objection, index) => (
          <li key={`objection-${String(index)}`}>
            <FindingText>{`Objection: ${objection}`}</FindingText>
          </li>
        ))}
      </ul>
    </details>
  )
}

function verdictLabel(entry: Pick<GroundedEntry, 'verdict'>) {
  return entry.verdict ? groundingVerdictLabels[entry.verdict] : 'No verdict yet'
}

/** How the round accounted for every finding, and the findings it left for a later round. */
export function GroundingSummary({
  grounding,
  reviewers,
}: {
  grounding: GroundingState
  reviewers: PanelReviewer[]
}) {
  const deferred = grounding.candidates.filter((candidate) => candidate.state === 'deferred')
  const resolved = grounding.resolved ?? []
  const counts = [
    `${String(grounding.candidates.length)} returned`,
    `${String(grounding.candidates.length - deferred.length)} grounded`,
    `${String(deferred.length)} deferred`,
    ...(['agreed', 'disputed', 'unverified'] as const).flatMap((resolution) => {
      const count = resolved.filter((entry) => entry.resolution === resolution).length
      return count ? [`${String(count)} ${resolution}`] : []
    }),
  ]
  const verdicts = [...groundingVerdicts, undefined].flatMap((verdict) => {
    const count = resolved.filter((entry) => entry.verdict === verdict).length
    return count ? [`${verdictLabel({ verdict })} ${String(count)}`] : []
  })
  const followUps = resolved.filter((entry) => triage(entry).followUp).length
  if (followUps) verdicts.push(`${String(followUps)} follow-ups`)
  return (
    <>
      <p className="muted panel-grounding-counts">{counts.join(' · ')}</p>
      {verdicts.length > 0 && (
        <p className="muted panel-grounding-counts">{verdicts.join(' · ')}</p>
      )}
      {deferred.length > 0 && (
        <details className="finding-notes">
          <summary>Deferred to a later round · {deferred.length}</summary>
          <ul>
            {deferred.map((candidate) => (
              <li key={candidate.key}>
                <strong>{candidate.finding.title}</strong>{' '}
                <span className="muted">
                  · {reviewerName(reviewers, candidate.seat)} · #{candidate.rank + 1} in its list
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
