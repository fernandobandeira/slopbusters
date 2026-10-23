import { useState } from 'react'
import * as routes from '../../../shared/api'
import { gateRevision, type Gate } from '../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { call, message } from '../../lib/api'

/**
 * Proceed on one reviewed PR: save the gate as the author sees it, including text still being
 * typed, then send the fixes from exactly that saved revision.
 */
export function usePanelProceed(
  session: PanelSession,
  result: PanelResult,
  gate: Gate,
  replace: (session: PanelSession) => void,
) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  async function proceed() {
    if (sending) return
    setSending(true)
    setError('')
    try {
      const saved = await call(routes.savePanelGate, {
        params: { id: session.id },
        body: { url: result.pull.url, gate },
      })
      replace(saved)
      const latest = saved.results.find((item) => item.pull.url === result.pull.url)
      const revision = gateRevision(latest?.fingerprint ?? result.fingerprint, latest?.gate)
      replace(
        await call(routes.proceedPanelFixes, {
          params: { id: session.id },
          body: { url: result.pull.url, revision },
        }),
      )
    } catch (cause) {
      setError(message(cause))
    } finally {
      setSending(false)
    }
  }
  /** Start a round over the fix thread's committed local fixes, then open it. */
  async function reviewLocal(onOpen: (sessionId: string) => void) {
    if (sending) return
    setSending(true)
    setError('')
    try {
      const round = await call(routes.reviewLocalFixes, {
        params: { id: session.id },
        body: { url: result.pull.url },
      })
      onOpen(round.id)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setSending(false)
    }
  }
  return {
    sending,
    error,
    proceed: () => void proceed(),
    reviewLocal: (onOpen: (sessionId: string) => void) => void reviewLocal(onOpen),
  }
}
