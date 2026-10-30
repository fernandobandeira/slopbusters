import type { SourceHistory } from './sourceNavigationHistory'

/** Back and forward through opened source, the diff layout, and preparing a local checkout. */
export function SourceToolbar({
  history,
  busy,
  split,
  canPrepare,
  onStep,
  onToggleSplit,
  onPrepare,
}: {
  history: SourceHistory
  busy: boolean
  /** The diff layout, when the source shows as a diff. */
  split?: boolean
  canPrepare: boolean
  onStep: (step: -1 | 1) => void
  onToggleSplit: () => void
  onPrepare: () => void
}) {
  return (
    <nav className="source-context-toolbar" aria-label="Source navigation">
      {history.visits.length > 0 && (
        <>
          <button
            type="button"
            aria-label="Back in source"
            disabled={busy || history.index < 0}
            onClick={() => {
              onStep(-1)
            }}
          >
            ← Back
          </button>
          <button
            type="button"
            aria-label="Forward in source"
            disabled={busy || history.index + 1 >= history.visits.length}
            onClick={() => {
              onStep(1)
            }}
          >
            Forward →
          </button>
        </>
      )}
      {split !== undefined && (
        <button type="button" aria-pressed={split} onClick={onToggleSplit}>
          {split ? 'Unified' : 'Split'}
        </button>
      )}
      {canPrepare && (
        <button type="button" disabled={busy} onClick={onPrepare}>
          Prepare local source
        </button>
      )}
    </nav>
  )
}
