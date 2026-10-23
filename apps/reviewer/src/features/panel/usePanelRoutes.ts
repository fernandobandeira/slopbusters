import { useState } from 'react'
import * as routes from '../../../shared/api'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { call, message } from '../../lib/api'

/** Route ready findings to another layer's round, or draft the PR's title or description. */
export function usePanelRoutes(
  session: PanelSession,
  result: PanelResult,
  replace: (session: PanelSession) => void,
) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  async function run(key: string, request: () => Promise<PanelSession>) {
    if (busy) return
    setBusy(key)
    setError('')
    try {
      replace(await request())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(undefined)
    }
  }
  const params = { id: session.id }
  return {
    busy,
    error,
    toLayer: (pull: number) =>
      void run(`layer:${String(pull)}`, () =>
        call(routes.routePanelLayer, { params, body: { url: result.pull.url, pull } }),
      ),
    draft: (field: 'title' | 'description') =>
      void run(field, () =>
        call(routes.draftPanelMetadata, { params, body: { url: result.pull.url, field } }),
      ),
  }
}
