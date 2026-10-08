import { useEffect, useState } from 'react'
import * as routes from '../../../shared/api/jobs'
import type { JobsAnswer, JobsSession } from '../../../shared/domain/jobs'
import { call, message } from '../../lib/api'

type Action = 'start' | 'retry' | 'continue' | 'cancel'

/** The latest Jobs review of one ticket, polled while a model is working on it. */
export function useJobsSession(ticket: string, repository: string) {
  const [session, setSession] = useState<JobsSession>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    call(routes.latestJobs, { query: { ticket } }, { signal: controller.signal })
      .then((result) => {
        setSession(result.session ?? undefined)
        setError('')
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
    }
  }, [ticket])
  useJobsPolling(session, setSession, setError)

  async function perform(request: () => Promise<JobsSession>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setSession(await request())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  function act(action: Action) {
    const params = { id: session?.id ?? '' }
    return perform(() =>
      action === 'start'
        ? call(routes.startJobs, { body: { ticket, repository } })
        : action === 'cancel'
          ? call(routes.cancelJobs, { params })
          : action === 'retry'
            ? call(routes.retryJobs, { params })
            : call(routes.continueJobs, { params }),
    )
  }
  return {
    session,
    loading,
    busy,
    error,
    act,
    answer: (answers: JobsAnswer[]) =>
      perform(() =>
        call(routes.answerJobs, { params: { id: session?.id ?? '' }, body: { answers } }),
      ),
    apply: (changes: { title: string; description: string }) =>
      perform(() => call(routes.applyJobs, { params: { id: session?.id ?? '' }, body: changes })),
  }
}

function useJobsPolling(
  session: JobsSession | undefined,
  setSession: (session: JobsSession) => void,
  setError: (error: string) => void,
) {
  const runningId = session?.status === 'running' ? session.id : undefined
  useEffect(() => {
    if (!runningId) return
    const id = runningId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await call(routes.getJobs, { params: { id } }, { signal: controller.signal })
        if (controller.signal.aborted) return
        setSession(next)
        setError('')
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500)
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(message(cause))
        timer = setTimeout(() => void poll(), 4000)
      }
    }
    timer = setTimeout(() => void poll(), 1500)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [runningId, setSession, setError])
}
