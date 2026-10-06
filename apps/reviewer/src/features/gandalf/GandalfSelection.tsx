import { Link } from 'react-router'
import type { InboxPull } from '../../../shared/domain/types'
import { Button } from '~/components/ui/button'

export function GandalfSelection({
  pulls,
  selected,
  onChange,
  onStart,
  ready,
  disabled,
}: {
  pulls: InboxPull[]
  selected: string[]
  onChange: (urls: string[]) => void
  onStart: () => void
  ready: boolean
  disabled: boolean
}) {
  return (
    <>
      <p className="gandalf-speech">You shall not pass… until these conflicts are resolved.</p>
      <p>Which PRs should I resolve?</p>
      <div className="gandalf-picks">
        {pulls.map((pull) => (
          <label key={pull.url}>
            <input
              type="checkbox"
              aria-label={`Select PR #${pull.number} for Gandalf`}
              checked={selected.includes(pull.url)}
              disabled={disabled || (!selected.includes(pull.url) && selected.length >= 20)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, pull.url]
                    : selected.filter((url) => url !== pull.url),
                )
              }}
            />
            <span>
              <strong>#{pull.number}</strong> {pull.title}
            </span>
          </label>
        ))}
      </div>
      {!pulls.length && <p className="muted">No PRs with conflicts in this view.</p>}
      <p className="gandalf-detail">
        Stacked PRs are updated bottom-up, including the other open layers in each selected stack.
      </p>
      {!ready && (
        <p>
          Choose your primary model in <Link to="/settings">Settings</Link> first.
        </p>
      )}
      <Button size="sm" disabled={disabled || !ready || !selected.length} onClick={onStart}>
        Resolve {selected.length || ''} {selected.length === 1 ? 'PR' : 'PRs'}
      </Button>
    </>
  )
}
