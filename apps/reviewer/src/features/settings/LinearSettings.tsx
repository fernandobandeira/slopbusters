import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { disconnectLinear, saveLinearKey } from '../../../shared/api/tickets'
import { LinearConnectButton } from '../../components/LinearConnect'
import { call, message } from '../../lib/api'
import { useLinearStatus } from '../../lib/useLinearStatus'

export function LinearSettings() {
  const [refresh, setRefresh] = useState(0)
  const status = useLinearStatus(refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function perform(request: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await request()
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  const data = status.data
  return (
    <section className="settings-section" aria-labelledby="linear-settings-title">
      <h2 id="linear-settings-title">Linear</h2>
      <p className="muted">
        Review tickets with Steve Jobs, and give Uncle Bob and Linus the issue each PR implements.
      </p>
      {status.error && <p role="alert">{status.error}</p>}
      {data?.connected ? (
        <div className="linear-connected">
          <span>
            {data.detail}
            {data.method === 'key' ? ' with a personal API key' : ''}.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void perform(() => call(disconnectLinear, {}))}
          >
            Disconnect
          </Button>
        </div>
      ) : data?.connecting ? (
        <p role="status">Approve access in your browser. This page updates when you do.</p>
      ) : (
        data?.oauthAvailable && (
          <LinearConnectButton
            onStarted={() => {
              setRefresh((value) => value + 1)
            }}
          />
        )
      )}
      {data && !data.connected && (
        <ApiKeyForm
          open={!data.oauthAvailable}
          busy={busy}
          onSave={(key) => void perform(() => call(saveLinearKey, { body: { key } }))}
        />
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  )
}

function ApiKeyForm({
  open,
  busy,
  onSave,
}: {
  open: boolean
  busy: boolean
  onSave: (key: string) => void
}) {
  const [key, setKey] = useState('')
  return (
    <details open={open}>
      <summary>Use a personal API key instead</summary>
      <p className="muted">
        Create one in Linear under Settings, Account, Security &amp; access. It stays on this
        computer.
      </p>
      <form
        className="linear-key-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(key)
        }}
      >
        <Input
          type="password"
          aria-label="Linear API key"
          placeholder="lin_api_…"
          value={key}
          onChange={(event) => {
            setKey(event.target.value)
          }}
        />
        <Button type="submit" variant="outline" disabled={busy || key.trim().length < 10}>
          Save key
        </Button>
      </form>
    </details>
  )
}
