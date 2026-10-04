import { Link } from 'react-router'
import type { InboxPull } from '../shared/types'
import { Button } from './vendor/t3/components/ui/button'

export interface LinusPullSelectionState {
  active: boolean
  urls: string[]
  target: HTMLElement | null
  onChoose: () => void
  onChange: (urls: string[]) => void
  onCancel: () => void
}

export function LinusPullSelection({
  pulls,
  selected,
  ready,
  busy,
  onChange,
  onStart,
  onCancel,
}: {
  pulls: InboxPull[]
  selected: string[]
  ready: boolean
  busy: boolean
  onChange: (urls: string[]) => void
  onStart: () => void
  onCancel: () => void
}) {
  return (
    <section className="linus-inbox-selection" aria-label="Select PRs for Linus">
      <div>
        <strong>Select PRs for Linus</strong>
        <p className="muted">
          {ready ? (
            'Choose up to 20 PRs from your list for two independent reviews.'
          ) : (
            <>
              Choose your{' '}
              <Link to="/settings" onClick={onCancel}>
                primary model in Settings
              </Link>{' '}
              first.
            </>
          )}
        </p>
      </div>
      <div className="linus-selection-toolbar">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(pulls.slice(0, 20).map((pull) => pull.url))}
          disabled={!pulls.length || busy}
        >
          Select all{pulls.length > 20 ? ' (first 20)' : ''}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange([])}
          disabled={!selected.length || busy}
        >
          Clear
        </Button>
        <span role="status">{selected.length} selected</span>
        <Button size="sm" disabled={!ready || !selected.length || busy} onClick={onStart}>
          Review selected
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
