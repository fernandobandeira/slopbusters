import { LoaderCircle } from 'lucide-react'
import type { GandalfSession } from '../../../shared/domain/gandalf'
import { Button } from '~/components/ui/button'

export function GandalfProgress({
  session,
  busy,
  onCancel,
  onRetry,
  onChoose,
}: {
  session: GandalfSession
  busy: boolean
  onCancel: () => void
  onRetry: () => void
  onChoose: () => void
}) {
  const active = session.status === 'running'
  const latest = session.turns.at(-1)
  return (
    <>
      <p className="gandalf-speech" role="status">
        {active && <LoaderCircle size={15} className="animate-spin" />}
        {session.progress}
      </p>
      <p className="gandalf-detail">
        {session.results.length} of {session.urls.length} PRs finished
      </p>
      {latest && (
        <p className="gandalf-detail">
          <strong>
            {latest.role === 'primary' ? 'Primary' : 'Secondary'} · turn {latest.round}
          </strong>
          <br />
          {latest.summary}
        </p>
      )}
      {session.failureContext && (
        <p className="gandalf-detail">Stopped during: {session.failureContext}</p>
      )}
      {session.error && <p role="alert">{session.error}</p>}
      {session.results.map((result) => (
        <p className="gandalf-detail" key={result.url}>
          <a href={result.url} target="_blank" rel="noreferrer">
            PR #{result.number}
          </a>
          {' · '}
          {result.published ? `Updated ${result.resolvedSha.slice(0, 8)}` : 'Already up to date'}
        </p>
      ))}
      <GandalfHistory turns={session.turns} />
      <div className="gandalf-actions">
        {active ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel resolution
          </Button>
        ) : (
          <>
            {session.status !== 'complete' && (
              <Button size="sm" disabled={busy} onClick={onRetry}>
                Retry remaining PRs
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={onChoose}>
              Choose PRs
            </Button>
          </>
        )}
      </div>
    </>
  )
}

function GandalfHistory({ turns }: { turns: GandalfSession['turns'] }) {
  if (!turns.length) return null
  return (
    <details className="gandalf-history">
      <summary>Resolution and review turns</summary>
      {turns.map((turn, index) => (
        <div key={index}>
          <strong>
            {turn.role === 'primary' ? 'Primary' : 'Secondary'} · turn {turn.round}
            {turn.approved ? ' · Approved' : ''}
          </strong>
          <p>{turn.summary}</p>
          {turn.issues.map((issue, issueIndex) => (
            <p key={issueIndex}>{issue}</p>
          ))}
          {!!turn.changedPaths.length && <p>Changed: {turn.changedPaths.join(', ')}</p>}
        </div>
      ))}
    </details>
  )
}
