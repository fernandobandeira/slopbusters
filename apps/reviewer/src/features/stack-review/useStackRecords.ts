import { useState } from 'react'
import * as routes from '../../../shared/api/stackReviewRecords'
import type { StackRecordsRead } from '../../../shared/api/stackReviewRecords'
import { call, message } from '../../lib/api'
import { useApiQuery } from '../../lib/useApiQuery'

export function useStackRecords(id: string, enabled: boolean) {
  const params = { id }
  const query = useApiQuery(routes.getStackRecords, { params }, { enabled })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function write(run: () => Promise<StackRecordsRead>) {
    setBusy(true)
    setError('')
    try {
      query.setData(await run())
    } catch (cause) {
      setError(message(cause))
      query.reload()
    } finally {
      setBusy(false)
    }
  }
  return {
    data: query.data,
    busy: busy || query.loading || !query.data,
    error: error || query.error,
    answer: (body: routes.AnswerWrite) =>
      write(() => call(routes.putStackAnswer, { params, body })),
    bulk: (answers: routes.BulkWrite) =>
      write(() => call(routes.putStackAnswers, { params, body: { answers } })),
    reopen: (body: Omit<routes.AnswerWrite, 'answer' | 'confirm'>) =>
      write(() => call(routes.reopenStackAnswer, { params, body })),
    disposition: (body: routes.DispositionWrite) =>
      write(() => call(routes.putStackDisposition, { params, body })),
  }
}

export type StackRecordActions = Omit<ReturnType<typeof useStackRecords>, 'data' | 'error'>
