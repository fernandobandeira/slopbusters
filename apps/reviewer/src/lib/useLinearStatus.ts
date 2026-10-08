import { useEffect } from 'react'
import { getLinearStatus } from '../../shared/api/tickets'
import { useApiQuery } from './useApiQuery'

/** Linear's connection state, polled while a browser sign-in is waiting for approval. */
export function useLinearStatus(refresh = 0) {
  const status = useApiQuery(getLinearStatus, {}, { refresh })
  const { reload } = status
  const connecting = status.data?.connecting === true
  useEffect(() => {
    if (!connecting) return
    const timer = setInterval(reload, 2000)
    return () => {
      clearInterval(timer)
    }
  }, [connecting, reload])
  return status
}
