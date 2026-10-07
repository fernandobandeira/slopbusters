import { Link } from 'react-router'
import type { InboxPull } from '../../../shared/domain/types'
import type { GandalfTask } from '../../../shared/domain/gandalf'
import { Button } from '~/components/ui/button'

const copy = {
  conflicts: {
    speech: 'You shall not pass… until these conflicts are resolved.',
    question: 'Which PRs should I resolve?',
    empty: 'No PRs with conflicts in this view.',
    verb: 'Resolve',
  },
  ci: {
    speech: 'You shall not pass… until CI is green.',
    question: 'Which PRs should I fix?',
    empty: 'No PRs with failing CI in this view.',
    verb: 'Fix',
  },
}

export function GandalfSelection({
  task,
  pulls,
  selected,
  onChange,
  onStart,
  ready,
  disabled,
}: {
  task: GandalfTask
  pulls: InboxPull[]
  selected: string[]
  onChange: (urls: string[]) => void
  onStart: () => void
  ready: boolean
  disabled: boolean
}) {
  return (
    <>
      <p className="gandalf-speech">{copy[task].speech}</p>
      <p>{copy[task].question}</p>
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
      {!pulls.length && <p className="muted">{copy[task].empty}</p>}
      <p className="gandalf-detail">
        {task === 'ci'
          ? 'Stacked PRs are fixed bottom-up, and each fix is merged into the layers above it.'
          : 'Stacked PRs are updated bottom-up, including the other open layers in each selected stack.'}
      </p>
      {!ready && (
        <p>
          Choose your primary model in <Link to="/settings">Settings</Link> first.
        </p>
      )}
      <Button size="sm" disabled={disabled || !ready || !selected.length} onClick={onStart}>
        {copy[task].verb} {selected.length || ''} {selected.length === 1 ? 'PR' : 'PRs'}
      </Button>
    </>
  )
}
