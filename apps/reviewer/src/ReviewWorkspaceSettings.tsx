import { useEffect, useState } from 'react'
import type { LocalReviewCheckout } from '../shared/workspace'
import { api, message } from './api'

export function ReviewWorkspaceSettings() {
  const [checkouts, setCheckouts] = useState<LocalReviewCheckout[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void api<LocalReviewCheckout[]>('/workspaces', { signal: controller.signal })
      .then(setCheckouts)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure))
      })
    return () => controller.abort()
  }, [])
  async function remove(checkout: LocalReviewCheckout) {
    setBusy(true)
    setError('')
    try {
      await api('/workspaces', {
        method: 'DELETE',
        body: JSON.stringify({ owner: checkout.owner, repo: checkout.repo, sha: checkout.sha }),
      })
      setCheckouts((current) => current.filter((entry) => entry.directory !== checkout.directory))
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-section" aria-labelledby="review-checkouts-title">
      <h2 id="review-checkouts-title">Local review checkouts</h2>
      <p className="muted">
        Source navigation and agents use separate local copies of the saved PR commit. Remove a copy
        to reclaim space; it can be downloaded again.
      </p>
      {error && <p role="alert">{error}</p>}
      {!checkouts.length && !error && <p className="muted">No local review checkouts.</p>}
      {checkouts.map((checkout) => (
        <div className="review-checkout-item" key={checkout.directory}>
          <div>
            <strong>
              {checkout.owner}/{checkout.repo} · {checkout.sha.slice(0, 8)}
            </strong>
            <p className="muted">{checkout.directory}</p>
            {checkout.error && <p role="alert">{checkout.error}</p>}
          </div>
          <button type="button" disabled={busy} onClick={() => void remove(checkout)}>
            Remove local copy
          </button>
        </div>
      ))}
    </section>
  )
}
