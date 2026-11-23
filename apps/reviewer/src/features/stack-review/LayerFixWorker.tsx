import { MAX_CHECKED_FIXES } from '../../../shared/domain/panelFix'
import { useCallback, useEffect, useState } from 'react'
import * as routes from '../../../shared/api/layerFix'
import { groundingKindLabels } from '../../../shared/domain/grounding'
import type { LayerFixSession } from '../../../shared/domain/layerFix'
import type { BriefFix } from '../../../shared/domain/stackBrief'
import type { BriefLayer } from '../../../shared/domain/stackBriefLayers'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'
import { Button } from '~/components/ui/button'

import type { StackFixSelection } from './useStackFixSelection'

export function LayerFixWorker({
  stack,
  layer,
  fixes,
  selection,
}: {
  stack: string
  layer: BriefLayer
  fixes: BriefFix[]
  selection: StackFixSelection
}) {
  const {
    session,
    availability,
    retryable,
    update,
    error: loadError,
  } = useWorkerSession(stack, layer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { report } = selection
  const running = session?.status === 'running'
  useEffect(() => {
    report(layer.url, availability && { ...availability, running })
    return () => {
      report(layer.url)
    }
  }, [availability, layer.url, report, running])
  const available = fixes.filter((fix) => !fix.applied && !availability?.applied.includes(fix.id))
  const selected = available.map((fix) => fix.id).filter((id) => selection.selected.includes(id))
  const blocked = availability?.blocked
  const failure = error || loadError
  const current = layer.current
  async function act(run: () => Promise<LayerFixSession>) {
    setBusy(true)
    setError('')
    try {
      update(await run())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  const tooMany = selected.length > MAX_CHECKED_FIXES
  return (
    <div>
      <FixSelection
        fixes={available}
        busy={selection.locked || !availability || Boolean(blocked)}
        current={current}
        selected={selected}
        update={selection.select}
      />
      {blocked && <p className="stack-warning">{blocked}</p>}
      {tooMany && <p>Choose at most {MAX_CHECKED_FIXES} fixes per run.</p>}
      {session && (
        <>
          <p role="status">
            {session.outcome ?? 'Working'}: {session.progress}
          </p>
          <WorkerOutcome session={session} />
          <WorkerActions
            session={session}
            busy={busy}
            retryable={retryable}
            act={act}
            setError={setError}
          />
        </>
      )}
      {failure && <p role="alert">{failure}</p>}
    </div>
  )
}

function useWorkerSession(stack: string, layer: BriefLayer) {
  const head = layer.currentHead ?? layer.reviewedHead ?? ''
  const base = layer.currentBase ?? layer.reviewedBase ?? ''
  const [refresh, setRefresh] = useState(0)
  const latest = useApiQuery(
    routes.latestLayerFix,
    { query: { url: layer.url, stack, head, base } },
    { refresh },
  )
  const [started, setStarted] = useState<LayerFixSession>()
  const session = started ?? latest.data?.session ?? undefined
  const update = useCallback((next: LayerFixSession) => {
    setStarted(next)
    if (next.status !== 'running') setRefresh((value) => value + 1)
  }, [])
  useWorkerPolling(session, update)
  return {
    session,
    update,
    availability: latest.data?.availability,
    retryable: Boolean(latest.data?.retryable && latest.data.session?.id === session?.id),
    loading: !latest.data,
    error: latest.error,
  }
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
  current,
  update,
}: {
  fixes: BriefFix[]
  busy: boolean
  selected: string[]
  current: boolean
  update: (id: string, checked: boolean) => void
}) {
  return (
    <fieldset disabled={busy}>
      <legend>Fixes to apply</legend>
      {fixes.map((fix) => (
        <div className="stack-review-fix" key={fix.id}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(fix.id)}
              disabled={!current && !fix.decision}
              onChange={(event) => {
                update(fix.id, event.target.checked)
              }}
            />
            {fix.title}
          </label>
          <p>{fix.plan ?? 'No plan recorded.'}</p>
          <p className="stack-brief-detail">{fixMeta(fix)}</p>
          {fix.decision?.note && <p>Private note: {fix.decision.note}</p>}
        </div>
      ))}
    </fieldset>
  )
}
function fixMeta(fix: BriefFix): string {
  return [
    fix.kind && groundingKindLabels[fix.kind],
    fix.decision && `Author’s choice · ${fix.decision.decisionId}`,
    fix.effort,
    fix.field && `PR ${fix.field} · Left for the author`,
    fix.derivedFrom && `Derived from ${fix.derivedFrom.join(', ')}`,
    fix.alsoRaised.length && `Also raised as ${fix.alsoRaised.join(', ')}`,
    fix.movedFrom && `Moved here from #${fix.movedFrom.layer}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function WorkerActions({
  session,
  busy,
  act,
  setError,
  retryable,
}: {
  session: LayerFixSession
  busy: boolean
  retryable: boolean
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
        retryable && (
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
