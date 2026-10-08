import { useEffect, useRef, useState } from 'react'
import * as routes from '../../../shared/api'
import type { PullRequest } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'

interface Options {
  onReady: (pull: PullRequest) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export function useMarkPullReady(pull: PullRequest, options: Options) {
  const [markingReady, setMarkingReady] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function markReady() {
    if (inFlight.current) return
    inFlight.current = true
    setMarkingReady(true)
    options.onError('')
    try {
      const updated = await call(routes.markPullReady, { params: { id: pull.id } })
      if (!mounted.current) return
      options.onReady(updated)
      options.onNotice('Pull request marked ready for review.')
    } catch (error) {
      if (mounted.current) options.onError(message(error))
    } finally {
      inFlight.current = false
      if (mounted.current) setMarkingReady(false)
    }
  }

  return { markingReady, markReady }
}
