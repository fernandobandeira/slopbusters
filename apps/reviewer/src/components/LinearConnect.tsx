import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { connectLinear } from '../../shared/api/tickets'
import { call, message } from '../lib/api'

/** One click: open Linear's consent page in the browser; the app polls until it is approved. */
export function LinearConnectButton({ onStarted }: { onStarted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function connect() {
    setBusy(true)
    setError('')
    try {
      const { url } = await call(connectLinear, {})
      window.open(url, '_blank', 'noopener,noreferrer')
      onStarted()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="linear-connect">
      <Button onClick={() => void connect()} disabled={busy}>
        {busy ? 'Opening Linear…' : 'Connect Linear'}
      </Button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  )
}
