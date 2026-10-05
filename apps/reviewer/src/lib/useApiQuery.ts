import { useCallback, useEffect, useState, type SetStateAction } from 'react'
import type { z } from 'zod'
import type { ApiContract, CallInput } from '../../shared/api/contract'
import { call, message } from './api'

/** Keyed results never display an old request after the selected resource changes. */
export function useApiQuery<C extends ApiContract>(
  contract: C,
  input: CallInput<C>,
  options: { enabled?: boolean; refresh?: number } = {},
) {
  type Data = z.output<C['response']>
  const inputKey = JSON.stringify(input)
  const key = `${contract.method}:${contract.path}:${inputKey}:${options.refresh ?? 0}`
  const enabled = options.enabled !== false
  const [result, setResult] = useState<{ key: string; data?: Data; error?: string }>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void call(contract, JSON.parse(inputKey) as CallInput<C>, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, error: message(error) })
      })
    return () => {
      controller.abort()
    }
  }, [contract, inputKey, key, enabled, revision])
  const setData = useCallback(
    (action: SetStateAction<Data | undefined>) => {
      setResult((previous) => ({
        key,
        data:
          typeof action === 'function'
            ? (action as (previous: Data | undefined) => Data | undefined)(
                previous?.key === key ? previous.data : undefined,
              )
            : action,
      }))
    },
    [key],
  )
  const current = result?.key === key && enabled ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: enabled && !current,
    setData,
    reload: useCallback(() => {
      setRevision((value) => value + 1)
    }, []),
  }
}
