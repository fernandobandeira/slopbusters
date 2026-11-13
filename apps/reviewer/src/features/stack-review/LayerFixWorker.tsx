import { useEffect, useState } from 'react'
import * as routes from '../../../shared/api/layerFix'
import type { LayerFixSession } from '../../../shared/domain/layerFix'
import type { BriefFix } from '../../../shared/domain/stackBrief'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'
import { Button } from '~/components/ui/button'

/** A layer's selected plans and its persisted unattended worker, within the stack feature. */
export function LayerFixWorker({
  stack,
  url,
  fixes,
  current,
}: {
  stack: string
  url: string
  fixes: BriefFix[]
  current: boolean
}) {
  const latest = useApiQuery(routes.latestLayerFix, { query: { url } })
  const [started, setStarted] = useState<LayerFixSession>()
  const [selected, setSelected] = useState(() => fixes.map((fix) => fix.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saved = latest.data?.session
  const session = started ?? (saved?.stack === stack ? saved : undefined)
  useWorkerPolling(session, setStarted)
  async function act(run: () => Promise<LayerFixSession>) {
    setBusy(true)
    setError('')
    try {
      setStarted(await run())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <p className="stack-brief-detail">
        Commits locally in an app-owned worktree. Pushes nothing.
      </p>
      {!session && (
        <FixSelection fixes={fixes} busy={busy} selected={selected} setSelected={setSelected} />
      )}
      {session ? (
        <>
          <p role="status">
            {session.outcome ?? 'Working'}: {session.progress}
          </p>
          <WorkerOutcome session={session} />
          <WorkerActions session={session} busy={busy} act={act} setError={setError} />
        </>
      ) : (
        <Button
          size="sm"
          disabled={busy || !current || !selected.length || latest.loading}
          onClick={() =>
            void act(() => call(routes.startLayerFix, { body: { stack, url, entries: selected } }))
          }
        >
          Apply fixes
        </Button>
      )}
      {(error || latest.error) && <p role="alert">{error || latest.error}</p>}
    </div>
  )
}

function WorkerOutcome({ session }: { session: LayerFixSession }) {
  return (
    <>
      {session.error && <p role="alert">{session.error}</p>}
      <ul>
        {session.commits.map((sha) => (
          <li key={sha}>
            Commit <code>{sha}</code>
          </li>
        ))}
        {session.results.map((fix) => (
          <li key={fix.entry}>
            {fix.entry}: {fix.status} — {fix.note}
          </li>
        ))}
        {session.commands.map((command) => (
          <li key={command.id}>
            <code>{command.input}</code>: exit {command.exitCode ?? 'unknown'}
            {command.outputIndicatesFailure && ' (failure)'}
          </li>
        ))}
        {session.left.map((left) => (
          <li key={left}>Left for the author: {left}</li>
        ))}
      </ul>
    </>
  )
}

function useWorkerPolling(
  session: LayerFixSession | undefined,
  update: (session: LayerFixSession) => void,
) {
  const id = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(
          routes.getLayerFix,
          { params: { id: id ?? '' } },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        update(next)
        if (next.status === 'running') timer = setTimeout(() => void poll(), 2000)
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000)
      }
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [id, update])
}

function FixSelection({
  fixes,
  busy,
  selected,
  setSelected,
}: {
  fixes: BriefFix[]
  busy: boolean
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
}) {
  return (
    <fieldset disabled={busy}>
      <legend>Fixes to apply</legend>
      {fixes.map((fix) => (
        <label key={fix.id} style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={selected.includes(fix.id)}
            onChange={(event) => {
              setSelected((previous) =>
                event.target.checked
                  ? [...previous, fix.id]
                  : previous.filter((id) => id !== fix.id),
              )
            }}
          />{' '}
          {fix.title}
          {fix.field && ' (left for the author)'}
        </label>
      ))}
    </fieldset>
  )
}
function WorkerActions({
  session,
  busy,
  act,
  setError,
}: {
  session: LayerFixSession
  busy: boolean
  act: (run: () => Promise<LayerFixSession>) => Promise<void>
  setError: (error: string) => void
}) {
  return (
    <>
      {session.status === 'running' ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void act(() => call(routes.cancelLayerFix, { params: { id: session.id } }))
          }
        >
          Cancel fixes
        </Button>
      ) : (
        session.outcome !== 'done' && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => call(routes.retryLayerFix, { params: { id: session.id } }))
            }
          >
            Retry fixes
          </Button>
        )
      )}
      {session.thread && (
        <Button
          variant="link"
          onClick={() => {
            void call(routes.openLayerFix, { params: { id: session.id } }).catch(
              (cause: unknown) => {
                setError(message(cause))
              },
            )
          }}
        >
          Open fix thread
        </Button>
      )}
    </>
  )
}
