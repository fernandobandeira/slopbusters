import {
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
import { reviewerName } from './PanelFaces'

/** What grounding decided about one finding: its verdict, whether both models agree, and why. */
export function GroundingVerdict({ result, id }: { result: PanelResult; id: string }) {
  const entry = result.grounding?.resolved?.find((item) => item.id === id)
  if (!entry) return null
  return (
    <div className="panel-grounding">
      <p className="finding-severity">
        {verdictLabel(entry)} · {groundingResolutionLabels[entry.resolution]}
      </p>
      <FindingText>{entry.reason}</FindingText>
      <EntryDetails entry={entry} />
      {entry.other && <OtherPosition other={entry.other} />}
    </div>
  )
}

function EntryDetails({ entry }: { entry: GroundedEntry }) {
  const details = [
    ['Plan', entry.plan],
    ['Question for the author', entry.question],
    ['Evidence needed', entry.missing],
  ] as const
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
