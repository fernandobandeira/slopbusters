import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import './pullLoading.css'

export function PullLoadingState({
  number,
  loading,
  error,
  inboxUrl,
  onRetry,
}: {
  number: number
  loading: boolean
  error?: string
  inboxUrl: string
  onRetry: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [loading])
  return (
    <section
      className="pull-loading-state"
      aria-busy={loading}
      aria-labelledby="pull-loading-title"
    >
      <div className="pull-loading-heading">
        {loading && <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />}
        <div>
          <h2 id="pull-loading-title">
            {loading ? `Opening PR #${number}…` : `Could not open PR #${number}`}
          </h2>
          <p role={loading ? 'status' : 'alert'}>
            {loading
              ? 'Fetching the PR and checking its saved diff. Related changes will be grouped automatically.'
              : (error ?? 'Please try again.')}
          </p>
          {loading && seconds >= 10 && <p className="muted">Preparing your review · {seconds}s</p>}
        </div>
      </div>
      {loading && (
        <div className="pull-loading-preview" aria-hidden="true">
          <div className="pull-loading-groups">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} />
            ))}
          </div>
          <div className="pull-loading-code">
            {Array.from({ length: 9 }, (_, index) => (
              <div key={index} />
            ))}
          </div>
        </div>
      )}
      <div className="pull-loading-actions">
        <Link to={inboxUrl}>Back to inbox</Link>
        {!loading && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </section>
  )
}
