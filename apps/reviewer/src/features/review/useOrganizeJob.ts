import { useCallback, useEffect, useRef, useState } from 'react'
import * as routes from '../../../shared/api'
import type { PullRequest } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'

export function useOrganizeJob(
  pull: PullRequest,
  options: {
    configured: boolean
    onUpdate: (pull: PullRequest) => void
    setError: (error: string) => void
    setNotice: (notice: string) => void
  },
) {
  const grouped = pull.groupingSource !== 'files'
  const [job, setJob] = useState<string>()
  const [organizing, setOrganizing] = useState(!grouped && options.configured)
  const [organizationFailed, setOrganizationFailed] = useState(false)
  const autoStarted = useRef(false)
  const { onUpdate, setError, setNotice } = options

  const organize = useCallback(
    async (force = false) => {
      setError('')
      setNotice('')
      setOrganizing(true)
      setOrganizationFailed(false)
      try {
        const result = await call(routes.organizePull, { params: { id: pull.id }, body: { force } })
        if (result.complete) {
          onUpdate(await call(routes.getPull, { params: { id: pull.id } }))
          setOrganizing(false)
        } else setJob(result.id)
      } catch (error) {
        setError(message(error))
        setOrganizationFailed(true)
        setOrganizing(false)
      }
    },
    [pull.id, onUpdate, setError, setNotice],
  )

  useOrganizationPoll({
    job,
    pullId: pull.id,
    onUpdate,
    setError,
    setJob,
    setOrganizing,
    setOrganizationFailed,
  })
  useEffect(() => {
    if (grouped || !options.configured || autoStarted.current) return
    autoStarted.current = true
    void organize()
  }, [grouped, options.configured, organize])
  const cancel = useCallback(async () => {
    if (job) await call(routes.cancelJob, { params: { id: job } })
  }, [job])
  return { job, organizing, organizationFailed, organize, cancel }
}

function useOrganizationPoll(options: {
  job?: string
  pullId: string
  onUpdate: (pull: PullRequest) => void
  setError: (message: string) => void
  setJob: (id: string | undefined) => void
  setOrganizing: (value: boolean) => void
  setOrganizationFailed: (value: boolean) => void
}) {
  const { job, pullId, onUpdate, setError, setJob, setOrganizing, setOrganizationFailed } = options
  useEffect(() => {
    if (!job) return
    const jobId = job
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const fail = (error: unknown) => {
      setError(message(error))
      setOrganizationFailed(true)
      setJob(undefined)
      setOrganizing(false)
    }
    async function poll() {
      try {
        const result = await call(
          routes.getJob,
          { params: { id: jobId } },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        if (result.status === 'failed') {
          fail(new Error(result.error ?? 'Organization failed.'))
          return
        }
        if (result.status === 'complete') {
          const updated = await call(
            routes.getPull,
            { params: { id: pullId } },
            { signal: controller.signal },
          )
          controller.signal.throwIfAborted()
          onUpdate(updated)
          setJob(undefined)
          setOrganizing(false)
        } else timer = setTimeout(() => void poll(), 1500)
      } catch (error) {
        if (!controller.signal.aborted) fail(error)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [job, pullId, onUpdate, setError, setJob, setOrganizing, setOrganizationFailed])
}
