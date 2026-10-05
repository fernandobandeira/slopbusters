import { useEffect, useState } from 'react'
import type { WorkspaceSetup } from '../shared/workspaceSetup'
import { message } from './api'
import { clearWorkspaceSetup, listWorkspaceSetups } from './workspaceSetupApi'

export function PreparedEnvironmentSettings() {
  const [jobs, setJobs] = useState<WorkspaceSetup[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void listWorkspaceSetups(controller.signal)
      .then(setJobs)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure))
      })
    return () => controller.abort()
  }, [])
  async function clear(id: string) {
    setBusy(true)
    setError('')
    try {
      await clearWorkspaceSetup(id)
      setJobs(await listWorkspaceSetups())
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }
  const active = jobs.filter(
    (job) => !['failed', 'cancelled'].includes(job.status) || job.directory,
  )
  return (
    <section className="settings-section" aria-labelledby="prepared-environments-title">
      <h2 id="prepared-environments-title">Prepared environments</h2>
      <p className="muted">
        Approved setup uses disposable PR copies. They are cleared when the app exits or after 30
        minutes without use. At most two can be prepared at once. Shared package-manager caches are
        retained.
      </p>
      {error && <p role="alert">{error}</p>}
      {!active.length && <p className="muted">No prepared environments.</p>}
      {active.map((job) => (
        <div className="review-checkout-item" key={job.id}>
          <div>
            <strong>
              {job.owner}/{job.repo} · {job.sha.slice(0, 8)}
            </strong>
            <p className="muted">
              {job.status} {job.directory}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={() => void clear(job.id)}>
            {['planning', 'running'].includes(job.status) ? 'Cancel setup' : 'Clear environment'}
          </button>
        </div>
      ))}
    </section>
  )
}
