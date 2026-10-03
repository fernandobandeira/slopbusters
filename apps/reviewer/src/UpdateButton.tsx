import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import type { UpdateState } from '../shared/desktop'
import { Button } from './vendor/t3/components/ui/button'

export function UpdateButton() {
  const [state, setState] = useState<UpdateState>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const bridge = window.reviewerDesktop
    if (!bridge) return
    let active = true
    let receivedEvent = false
    const unsubscribe = bridge.onUpdateState((next) => {
      receivedEvent = true
      if (active) setState(next)
    })
    void bridge
      .getUpdateState()
      .then((initial) => {
        if (active && !receivedEvent) setState(initial)
      })
      .catch(() => {
        /* Development and browser builds have no updater. */
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!state || ['disabled', 'idle', 'checking'].includes(state.status)) return null
  const downloading = state.status === 'downloading'
  const downloaded = state.status === 'downloaded'
  const failed = state.status === 'error'
  const label = downloaded
    ? 'Restart to update'
    : downloading
      ? `Downloading ${Math.floor(state.percent ?? 0)}%`
      : failed
        ? 'Retry update check'
        : `Update available · ${state.version}`

  async function update() {
    const bridge = window.reviewerDesktop
    if (!bridge || pending || downloading) return
    setPending(true)
    try {
      if (downloaded) await bridge.installUpdate()
      else if (failed) await bridge.checkForUpdates()
      else await bridge.downloadUpdate()
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Update failed.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <footer className="desktop-update-footer">
      <Button
        className="app-update"
        size="xs"
        variant="outline"
        disabled={pending || downloading}
        title={state.message ?? `Slopbusters Review ${state.version ?? ''}`}
        onClick={() => void update()}
      >
        {downloading ? (
          <LoaderCircle size={12} className="animate-spin" />
        ) : downloaded || failed ? (
          <RefreshCw size={12} />
        ) : (
          <Download size={12} />
        )}
        <span aria-live="polite">{label}</span>
      </Button>
    </footer>
  )
}
