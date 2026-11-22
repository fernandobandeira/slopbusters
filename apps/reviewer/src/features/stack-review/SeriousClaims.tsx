import { useState } from 'react'
import { groundingImpactLabels } from '../../../shared/domain/impact'
import type { BriefSerious } from '../../../shared/domain/stackBrief'
import { dispositionSummary } from '../../../shared/domain/stackReviewRecords'
import type { StackDisposition } from '../../../shared/domain/stackReviewRecords'
import { Button } from '~/components/ui/button'
import type { StackRecordActions } from './useStackRecords'

export function SeriousClaims({
  items,
  actions,
}: {
  items: BriefSerious[]
  actions: StackRecordActions
}) {
  return (
    <section className="stack-review-band">
      <h2>Serious consequences</h2>
      <ul className="stack-brief-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong> <code>{item.id}</code>
            <p>{item.consequence}</p>
            <p className="stack-brief-detail">
              {groundingImpactLabels[item.impact]} · {item.standing}
            </p>
            {item.disposition && <p>{dispositionSummary(item.disposition)}</p>}
            <ClaimControl key={item.revision ?? 0} item={item} actions={actions} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ClaimControl({ item, actions }: { item: BriefSerious; actions: StackRecordActions }) {
  const [kind, setKind] = useState('')
  const [detail, setDetail] = useState('')
  const [sha, setSha] = useState('')
  const checked = kind === 'fixed' || kind === 'refuted'
  const record = claimDisposition(kind, detail.trim(), sha.trim())
  const save = (disposition: StackDisposition | null) =>
    actions.disposition({ claimId: item.id, expectedRevision: item.revision ?? 0, disposition })
  return (
    <details className="stack-review-disclosure">
      <summary>{item.disposition ? 'Edit disposition' : 'Record disposition'}</summary>
      <fieldset disabled={actions.busy} className="stack-review-controls">
        <label className="stack-review-field">
          Disposition
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value)
            }}
          >
            <option value="">Choose a disposition</option>
            <option value="fixed">Fixed and checked</option>
            <option value="refuted">Refuted</option>
            <option value="accepted">Accepted as a risk</option>
            <option value="assigned">Assigned</option>
          </select>
        </label>
        {kind && (
          <label className="stack-review-field">
            {checked ? 'Evidence' : kind === 'assigned' ? 'Person' : 'Reason'}
            <textarea
              rows={2}
              maxLength={12000}
              value={detail}
              onChange={(event) => {
                setDetail(event.target.value)
              }}
            />
          </label>
        )}
        {checked && (
          <label className="stack-review-field">
            Checked commit SHA
            <input
              value={sha}
              onChange={(event) => {
                setSha(event.target.value)
              }}
            />
          </label>
        )}
        <div className="stack-review-actions">
          <Button
            size="sm"
            disabled={!record}
            onClick={() => {
              if (record) void save(record)
            }}
          >
            Save disposition
          </Button>
          {item.disposition && (
            <Button size="sm" variant="ghost" onClick={() => void save(null)}>
              Clear disposition
            </Button>
          )}
        </div>
      </fieldset>
    </details>
  )
}

function claimDisposition(kind: string, detail: string, sha: string): StackDisposition | undefined {
  if (!detail) return
  if ((kind === 'fixed' || kind === 'refuted') && sha)
    return { state: kind, evidence: detail, checkedSha: sha }
  if (kind === 'accepted') return { state: kind, reason: detail }
  if (kind === 'assigned') return { state: kind, person: detail }
}
