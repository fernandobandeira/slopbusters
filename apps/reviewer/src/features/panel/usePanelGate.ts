import { useState } from 'react'
import * as routes from '../../../shared/api'
import {
  gateItems,
  initialGate,
  readyItems,
  type Gate,
  type GateAction,
} from '../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { call, message } from '../../lib/api'

/**
 * The author's fix choices on one reviewed PR. Choices apply at once and save immediately; typed
 * text saves when the field is left, so a save never overwrites what is still being typed.
 */
export function usePanelGate(
  session: PanelSession,
  result: PanelResult,
  replace: (session: PanelSession) => void,
) {
  const entries = result.grounding?.resolved ?? []
  const saved = result.gate ?? initialGate(entries)
  const [draft, setDraft] = useState<{ fingerprint: string; gate: Gate }>()
  const gate = draft?.fingerprint === result.fingerprint ? draft.gate : saved
  const [planning, setPlanning] = useState<string>()
  const [error, setError] = useState('')
  const items = gateItems(entries, gate, result.pull.number)

  function edit(entry: string, changes: Partial<GateAction>): Gate {
    const actions = gate.actions.some((action) => action.entry === entry)
      ? gate.actions.map((action) => (action.entry === entry ? { ...action, ...changes } : action))
      : [...gate.actions, { entry, selected: false, ...changes }]
    const next = { actions: actions.map(withoutEmptyText) }
    setDraft({ fingerprint: result.fingerprint, gate: next })
    return next
  }
  async function save(next: Gate) {
    setError('')
    try {
      replace(
        await call(routes.savePanelGate, {
          params: { id: session.id },
          body: { url: result.pull.url, gate: next },
        }),
      )
    } catch (cause) {
      setError(message(cause))
    }
  }
  async function plan(entry: string) {
    if (planning) return
    setPlanning(entry)
    setError('')
    try {
      await save(gate)
      const next = await call(routes.planPanelFix, {
        params: { id: session.id },
        body: { url: result.pull.url, entry },
      })
      setDraft(undefined)
      replace(next)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setPlanning(undefined)
    }
  }
  return {
    /** The gate as the author sees it, including text not saved yet. */
    gate,
    items,
    ready: readyItems(items),
    planning,
    error,
    /** Change a choice and save it now. */
    choose: (entry: string, changes: Partial<GateAction>) => void save(edit(entry, changes)),
    /** Change text as it is typed; `commit` saves it. */
    type: (entry: string, changes: Partial<GateAction>) => {
      edit(entry, changes)
    },
    commit: () => void save(gate),
    plan: (entry: string) => void plan(entry),
  }
}

/** Cleared text fields are removed, so a cleared plan falls back to the models' plan. */
function withoutEmptyText({ plan, planBy, plannedFrom, answer, ...rest }: GateAction): GateAction {
  const planned = plan?.trim()
    ? { plan, ...(planBy ? { planBy } : {}), ...(plannedFrom === undefined ? {} : { plannedFrom }) }
    : {}
  return { ...rest, ...(answer?.trim() ? { answer } : {}), ...planned }
}
