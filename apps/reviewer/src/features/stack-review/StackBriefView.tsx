import { groundingKindLabels } from '../../../shared/domain/grounding'
import { short, type BriefFix, type StackBrief } from '../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../shared/domain/stackBriefMarkdown'
import { CopyButton } from '../../components/CopyButton'

/** The stack brief: the decision queue first, then each layer's fixes bottom to top. */
export function StackBriefView({ brief, repository }: { brief: StackBrief; repository: string }) {
  return (
    <div className="stack-brief">
      <div className="stack-brief-tools">
        <CopyButton label="Copy" text={stackBriefMarkdown(brief, repository)} />
      </div>
      <ol className="stack-brief-list" aria-label="Reviewed layers, bottom to top">
        {brief.layers.map((layer) => (
          <li key={layer.number}>
            #{layer.number} {layer.title}{' '}
            <span className={layer.current ? 'stack-brief-detail' : 'stack-brief-stale'}>
              {layer.current
                ? `reviewed at ${short(layer.reviewedHead)}, still current`
                : `reviewed at ${short(layer.reviewedHead)}, now at ${short(layer.currentHead)}`}
            </span>
          </li>
        ))}
      </ol>
      {brief.summary && <p className="stack-brief-summary">{brief.summary}</p>}
      <h3>Needs your decision</h3>
      {brief.decisions.length ? (
        <ul className="stack-brief-list">
          {brief.decisions.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong> <code>{item.id}</code>
              <p>{item.question}</p>
              <p className="stack-brief-detail">
                Recommendation: {item.recommendation ?? 'Leave it as it is.'} · Cost:{' '}
                {item.cost ?? 'not recorded'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stack-brief-detail">Nothing needs your decision.</p>
      )}
      {brief.fixes.map(({ layer, items }) => (
        <section key={layer.number} aria-label={`Fixes on PR #${String(layer.number)}`}>
          <h3>
            #{layer.number} {layer.title}
            {!layer.current && <span className="stack-brief-stale"> · moved since its panel</span>}
          </h3>
          <ol className="stack-brief-list">
            {items.map((item) => (
              <FixItem key={item.id} fix={item} />
            ))}
          </ol>
        </section>
      ))}
      <BriefNotes brief={brief} />
    </div>
  )
}

function FixItem({ fix }: { fix: BriefFix }) {
  const notes = [
    fix.derivedFrom ? `Derived from ${fix.derivedFrom.join(', ')}` : '',
    fix.alsoRaised.length ? `Also raised as ${fix.alsoRaised.join(', ')}` : '',
    fix.movedFrom ? `Moved here from #${String(fix.movedFrom.layer)}` : '',
    fix.contested ? 'The second model did not approve this' : '',
  ].filter(Boolean)
  return (
    <li>
      <strong>{fix.title}</strong> <code>{fix.id}</code>
      {fix.plan && <p>{fix.plan}</p>}
      <p className="stack-brief-detail">
        {[fix.kind && groundingKindLabels[fix.kind], fix.effort, ...notes]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </li>
  )
}

function BriefNotes({ brief }: { brief: StackBrief }) {
  return (
    <>
      {brief.chains.length > 0 && (
        <>
          <h3>Made unnecessary</h3>
          <ul className="stack-brief-list">
            {brief.chains.map((chain) => (
              <li key={chain.cause.id}>
                <code>{chain.cause.id}</code> makes{' '}
                {chain.unnecessary.map((item) => item.id).join(', ')} unnecessary. {chain.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {brief.followUps.length > 0 && (
        <details className="stack-brief-details">
          <summary>{brief.followUps.length} follow-ups</summary>
          <ul className="stack-brief-list">
            {brief.followUps.map((item) => (
              <li key={item.id}>
                {item.title} <code>{item.id}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {[...brief.stale.map((item) => item.reason), ...brief.limitations].map((note) => (
        <p className="stack-warning" key={note}>
          {note}
        </p>
      ))}
    </>
  )
}
