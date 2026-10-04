import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { InboxPull } from '../shared/types'
import { Button } from './vendor/t3/components/ui/button'

export interface LinusPullSelectionState {
  active: boolean
  urls: string[]
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
    <section className="linus-pull-selection" aria-label="Select PRs for Linus">
      <p className="linus-speech">
        {ready ? (
          'Select PRs from your list. I’ll focus on descriptions and whether each change belongs together.'
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
      <div className="linus-selection-toolbar">
        <span role="status">{selected.length} / 20 selected</span>
        <div className="linus-selection-shortcuts">
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
        </div>
      </div>
      <div className="linus-selection-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready || !selected.length || busy} onClick={onStart}>
          {busy
            ? 'Starting…'
            : `Review${selected.length ? ` ${selected.length} PR${selected.length === 1 ? '' : 's'}` : ' selected'}`}
          <ChevronRight size={14} />
        </Button>
      </div>
    </section>
  )
}
