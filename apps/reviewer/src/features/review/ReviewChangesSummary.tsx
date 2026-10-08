import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import { Button } from '~/components/ui/button'

interface Props {
  changes?: ReviewChanges
  changesOnly: boolean
  onToggle: () => void
  onNext: () => void
}
export function ReviewChangesSummary({ changes, changesOnly, onToggle, onNext }: Props) {
  if (!changes) return null
  const count = (state: string) =>
    changes.sections.filter((section) => section.state === state).length
  return (
    <div className="review-update-summary" role="status">
      <div>
        <strong>Changes since your last review</strong>
        <span className="muted"> Compared with {changes.baselineHeadSha.slice(0, 7)}</span>
        <p>
          {count('new')} new · {count('changed')} changed · {count('context-changed')} context
          changed · {changes.removed.length} removed sections
        </p>
      </div>
      {!!changes.incompletePaths?.length && (
        <p className="muted">
          {changes.incompletePaths.length} files have incomplete patches; their changes cannot be
          fully compared.
        </p>
      )}
      <div className="review-update-actions">
        <Button
          size="xs"
          variant={changesOnly ? 'secondary' : 'ghost'}
          aria-pressed={changesOnly}
          onClick={onToggle}
        >
          {changesOnly ? 'Show all changes' : 'Changes since review'}
        </Button>
        {changes.sections.length > 0 && (
          <Button size="xs" variant="ghost" onClick={onNext}>
            Next updated section
          </Button>
        )}
      </div>
      {changes.removed.length > 0 && (
        <details className="removed-sections">
          <summary>Inspect removed changes ({changes.removed.length})</summary>
          <p className="muted">
            These edits were present in the previous review and are absent from the current PR diff.
          </p>
          {changes.removed.map((section, index) => (
            <details key={`${section.path}:${index}`}>
              <summary>
                {section.path}:{section.line}
              </summary>
              <pre>{section.code}</pre>
            </details>
          ))}
        </details>
      )}
    </div>
  )
}
