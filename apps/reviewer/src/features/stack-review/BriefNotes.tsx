import type { StackBrief } from '../../../shared/domain/stackBrief'
import { reviewLimitations, unreadByLayer } from '../../../shared/domain/stackReviewView'

export function BriefNotes({ brief }: { brief: StackBrief }) {
  const limitations = reviewLimitations(brief)
  return (
    <>
      <LeftOut brief={brief} />
      <details className="stack-review-band">
        <summary>Review notes</summary>
        {brief.summary && <p>{brief.summary}</p>}
        <ul className="stack-brief-list">
          {limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
          {brief.stale.map((item, index) => (
            <li key={index}>
              {item.reason} {item.entries.join(', ')}
            </li>
          ))}
        </ul>
        {!brief.summary && !limitations.length && !brief.stale.length && <p>No review notes.</p>}
      </details>
    </>
  )
}

function LeftOut({ brief }: { brief: StackBrief }) {
  const { chains } = brief
  const unread = brief.unread.length
  const unreadIds = new Set(brief.unread.map(({ id }) => id))
  const followUps = brief.followUps.filter(({ id }) => !unreadIds.has(id))
  const leftOut = unread + followUps.length + chains.length
  const breakdown = [
    unread && `${unread} unread`,
    followUps.length &&
      `${followUps.length} ${followUps.length === 1 ? 'follow-up' : 'follow-ups'}`,
    chains.length && `${chains.length} ${chains.length === 1 ? 'chain' : 'chains'}`,
  ]
    .filter(Boolean)
    .join(' · ')
  if (!leftOut) return null
  return (
    <details className="stack-review-band">
      <summary>
        Left out · {leftOut}
        <span className="stack-brief-detail stack-review-breakdown">{breakdown}</span>
      </summary>
      {unread > 0 && <UnreadEntries brief={brief} />}
      {followUps.length > 0 && (
        <>
          <h3>Follow-ups · {followUps.length}</h3>
          <ul className="stack-brief-list">
            {followUps.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <p className="stack-brief-detail">
                  PR #{item.layer} · {item.triage}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {brief.chains.length > 0 && (
        <>
          <h3>Changes another fix could make unnecessary · {brief.chains.length}</h3>
          <ul className="stack-brief-list">
            {brief.chains.map((chain) => (
              <li key={chain.cause.id}>
                <p>
                  If <strong>{chain.cause.title}</strong> is applied and checked, these changes may
                  be unnecessary:
                </p>
                <ul className="stack-brief-list">
                  {chain.unnecessary.map((item) => (
                    <li key={item.id}>{item.title}</li>
                  ))}
                </ul>
                <p className="stack-brief-detail">{chain.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  )
}

function UnreadEntries({ brief }: { brief: StackBrief }) {
  const followUpById = new Map(brief.followUps.map(({ id, triage }) => [id, triage]))
  return (
    <>
      <h3>Entries the cross-layer pass did not read · {brief.unread.length}</h3>
      {unreadByLayer(brief).map(([layer, items]) => (
        <div key={layer}>
          <p className="stack-brief-detail">PR #{layer}</p>
          <ul className="stack-brief-list">
            {items.map(({ id, title }) => {
              const triage = followUpById.get(id)
              return (
                <li key={id}>
                  {title}
                  {triage !== undefined && (
                    <p className="stack-brief-detail">Follow-up · {triage}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}
