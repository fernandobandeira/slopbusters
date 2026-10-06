import { useEffect, useState } from 'react'
import type { AgentEvent, AgentRun } from '../../../shared/domain/agentSession'
import * as routes from '../../../shared/api/agentSessions'
import { call, message } from '../../lib/api'

export function useRunTranscript(sessionId: string, runId?: string) {
  const key = `${sessionId}:${runId ?? ''}`
  const [result, setResult] = useState<{
    key: string
    events: AgentEvent[]
    run?: AgentRun
    error?: string
  }>()
  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let cursor = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let events = new Map<string, AgentEvent>()
    async function poll() {
      try {
        const response = await call(
          routes.getAgentRunEvents,
          { params: { id: sessionId, runId: runId ?? '' }, query: { after: cursor } },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        for (const event of response.events) events.set(event.id, event)
        cursor = response.cursor
        setResult({
          key,
          events: [...events.values()].sort((a, b) => a.position - b.position),
          run: response.run,
        })
        if (response.more || response.run.status === 'running')
          timer = setTimeout(() => void poll(), response.more ? 0 : 750)
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ key, events: [...events.values()], error: message(error) })
          timer = setTimeout(() => void poll(), 2000)
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
      events = new Map()
    }
  }, [key, sessionId, runId])
  return result?.key === key ? result : undefined
}
