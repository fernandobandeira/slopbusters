import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'
import type { InboxPull } from '../../../shared/domain/types'

/** PRs being picked from the list for an action, such as Linus or the review panel. */
export interface PullSelection {
  /** Who the PRs are picked for, as in "Select PR #12 for the panel". */
  purpose: string
  urls: string[]
  max: number
  onChange: (urls: string[]) => void
  /** What to do with the picked PRs; without it, the action lives elsewhere, as Linus's does. */
  actions?: ReactNode
  onCancel?: () => void
}

/** The picked PRs' count, shortcuts to pick the shown ones, and the actions on them. */
export function SelectionBar({
  selection,
  visible,
}: {
  selection: PullSelection
  visible: InboxPull[]
}) {
  const { urls, max } = selection
  const shown = visible.map((pull) => pull.url)
  const picked = [...urls, ...shown.filter((url) => !urls.includes(url))].slice(0, max)
  return (
    <section className="inbox-selection-bar" aria-label="Selected PRs">
      <span role="status">
        <strong>{urls.length}</strong> of up to {max} selected
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={!shown.length || picked.length === urls.length}
        onClick={() => {
          selection.onChange(picked)
        }}
      >
        Select shown{shown.length > max ? ` (first ${String(max)})` : ''}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!urls.length}
        onClick={() => {
          selection.onChange([])
        }}
      >
        Clear
      </Button>
      <span className="inbox-selection-spacer" />
      {selection.actions}
      <Button size="sm" variant="ghost" onClick={selection.onCancel}>
        Cancel
      </Button>
    </section>
  )
}
