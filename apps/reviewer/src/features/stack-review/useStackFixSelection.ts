import { useCallback, useState } from 'react'
import { startStackFixes } from '../../../shared/api/layerFix'
import { MAX_CHECKED_FIXES } from '../../../shared/domain/panelFix'
import type { StackBrief } from '../../../shared/domain/stackBrief'
import { call, message } from '../../lib/api'

interface LayerAvailability {
  applied: string[]
  blocked?: string
  running: boolean
}

export function useStackFixSelection(stack: string, visible: StackBrief['fixes']) {
  const [layers, setLayers] = useState<Record<string, LayerAvailability | undefined>>({})
  const [excluded, setExcluded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const report = useCallback((url: string, state?: LayerAvailability) => {
    setLayers((previous) => ({ ...previous, [url]: state }))
  }, [])
  function select(id: string, checked: boolean) {
    setExcluded((previous) =>
      checked ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }
  const eligible = visible.map(({ layer, items }) => {
    const state = layers[layer.url]
    const entries = items
      .filter(
        (fix) =>
          state &&
          !state.blocked &&
          !fix.applied &&
          !state.applied.includes(fix.id) &&
          (layer.current || fix.decision),
      )
      .map((fix) => fix.id)
    return { url: layer.url, entries }
  })
  const available = eligible.flatMap((group) => group.entries)
  const groups = eligible
    .map(({ url, entries }) => ({ url, entries: entries.filter((id) => !excluded.includes(id)) }))
    .filter((group) => group.entries.length)
  const selected = groups.flatMap((group) => group.entries)
  const locked = busy || Object.values(layers).some((state) => state?.running)
  const disabled =
    locked ||
    !selected.length ||
    visible.some(({ layer }) => !layers[layer.url]) ||
    groups.some((group) => group.entries.length > MAX_CHECKED_FIXES)
  function toggleAll() {
    setExcluded((previous) => [
      ...previous.filter((id) => !available.includes(id)),
      ...(selected.length ? available : []),
    ])
  }
  async function apply() {
    if (disabled) return
    setBusy(true)
    setError('')
    try {
      await call(startStackFixes, { body: { stack, groups } })
      setLayers({})
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return {
    available,
    selected,
    locked,
    disabled,
    error,
    revision,
    report,
    select,
    toggleAll,
    apply,
  }
}

export type StackFixSelection = ReturnType<typeof useStackFixSelection>
