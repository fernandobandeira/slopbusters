import { useEffect, useState } from 'react'
import { Provider, type DiffSide } from '../shared/types'
import { providerLabel } from '../shared/preferences'
import type { WorkspaceSetup } from '../shared/workspaceSetup'
import { message } from './api'
import {
  approveWorkspaceSetup,
  clearWorkspaceSetup,
  getWorkspaceSetup,
  listWorkspaceSetups,
  planWorkspaceSetup,
} from './workspaceSetupApi'

export function WorkspaceSetupPanel({
  pullId,
  sha,
  side,
  path,
  warnings,
}: {
  pullId: string
  sha: string
  side: DiffSide
  path: string
  warnings: string[]
}) {
  const [provider, setProvider] = useState(Provider.codex)
  const [job, setJob] = useState<WorkspaceSetup>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    const controller = new AbortController()
    void listWorkspaceSetups(controller.signal)
      .then((jobs) => {
        setJob(
          (current) =>
            current ??
            jobs.find(
              (candidate) =>
                candidate.pullId === pullId &&
                candidate.sha === sha &&
                !['failed', 'cancelled'].includes(candidate.status),
            ),
        )
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure))
      })
    return () => controller.abort()
  }, [pullId, sha])
  useEffect(() => {
    if (!jobId || !jobStatus || !['planning', 'running'].includes(jobStatus)) return
    const controller = new AbortController()
    const timer = setInterval(() => {
      void getWorkspaceSetup(jobId, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setJob(next)
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setError(message(failure))
        })
    }, 1000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [jobId, jobStatus])
  async function perform(action: () => Promise<WorkspaceSetup>) {
    setBusy(true)
    setError('')
    try {
      setJob(await action())
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }
  const canPlan = !job || ['failed', 'cancelled'].includes(job.status)
  return (
    <details className="workspace-setup-panel">
      <summary>Prepare dependencies with Codex or Claude</summary>
      <p>
        The agent reads repository instructions and proposes setup commands. Nothing runs until you
        approve the list.
      </p>
      {canPlan && (
        <div>
          <label>
            Setup agent{' '}
            <select
              aria-label="Setup agent"
              value={provider}
              disabled={busy}
              onChange={(event) =>
                setProvider(
                  event.target.value === Provider.claude ? Provider.claude : Provider.codex,
                )
              }
            >
              <option value={Provider.codex}>Codex</option>
              <option value={Provider.claude}>Claude</option>
            </select>
          </label>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(() =>
                planWorkspaceSetup(pullId, {
                  side,
                  provider,
                  path,
                  warnings: warnings.slice(0, 30).map((warning) => warning.slice(0, 4000)),
                }),
              )
            }
          >
            Ask for a setup plan
          </button>
        </div>
      )}
      {job && (
        <p role="status">
          {providerLabel(job.provider)} ·{' '}
          {job.status === 'ready'
            ? 'Setup finished. Retry Go to definition.'
            : job.status.replaceAll('-', ' ')}
        </p>
      )}
      {job?.plan && (
        <>
          <p>{job.plan.explanation}</p>
          <ol>
            {job.plan.commands.map((command, index) => (
              <li key={index}>
                <p>{command.reason}</p>
                <code>{JSON.stringify([command.command, ...command.args])}</code> · directory:{' '}
                <code>{command.directory}</code>
              </li>
            ))}
          </ol>
        </>
      )}
      {job?.status === 'awaiting-approval' && Boolean(job.plan?.commands.length) && (
        <>
          <p>
            Allow these commands to execute repository setup scripts, download packages, and
            generate code in a disposable PR checkout. Shared package-manager caches may be
            populated. The app removes this environment when it exits; your original repository
            stays untouched.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void perform(() => approveWorkspaceSetup(pullId, job.id, side))}
          >
            Allow and run setup
          </button>
        </>
      )}
      {job?.status === 'awaiting-approval' && !job.plan?.commands.length && (
        <p>No setup commands proposed. Open the symbol in your configured IDE.</p>
      )}
      {job && (!['cancelled', 'failed'].includes(job.status) || job.directory) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void perform(() => clearWorkspaceSetup(job.id))}
        >
          {['planning', 'running'].includes(job.status)
            ? 'Cancel setup'
            : 'Clear prepared environment'}
        </button>
      )}
      {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
      {job?.log && (
        <details>
          <summary>Setup commands and output</summary>
          <pre className="workspace-setup-log">{job.log}</pre>
        </details>
      )}
    </details>
  )
}
