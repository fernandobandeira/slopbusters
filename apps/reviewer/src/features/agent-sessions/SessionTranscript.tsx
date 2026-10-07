import { Provider } from '../../../shared/domain/types'
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Terminal, LoaderCircle } from 'lucide-react'
import type { AgentRun, AgentEvent } from '../../../shared/domain/agentSession'
import { TimelineSystemDivider } from '~/components/chat/TimelineSystemDivider'
import { SessionMarkdown } from '~/components/chat/SessionMarkdown'
import { Button } from '~/components/ui/button'
import { modelName } from './sessionPresentation'
import { SessionResult } from './SessionResult'
import { useRunTranscript } from './useRunTranscript'

export function SessionTranscript({ sessionId, run }: { sessionId: string; run: AgentRun }) {
  const result = useRunTranscript(sessionId, run.id)
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [atEnd, setAtEnd] = useState(true)
  useEffect(() => {
    if (following.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [result?.events])
  const state = result?.run ?? run
  const events = result ? withoutEchoedResult(result.events) : []
  return (
    <section className="session-transcript" aria-label={`${modelName(run.model)} transcript`}>
      <header>
        <strong>
          {modelName(run.model)} · {run.label}
        </strong>
        <time>{new Date(run.startedAt).toLocaleString()}</time>
      </header>
      <div
        className="session-messages"
        ref={viewport}
        onScroll={() => {
          const node = viewport.current
          if (!node) return
          const end = node.scrollHeight - node.scrollTop - node.clientHeight < 80
          following.current = end
          setAtEnd(end)
        }}
      >
        <div className="session-message-column">
          <TimelineSystemDivider
            label="Pass started"
            detail={run.model.provider === Provider.codex ? 'Codex' : 'Claude'}
          />
          {!result && <p role="status">Loading transcript…</p>}
          {result?.error && <p role="alert">{result.error}</p>}
          {events.map((event) => (
            <TranscriptItem key={event.id} event={event} />
          ))}
          {state.status === 'running' && (
            <p className="session-working" role="status">
              <LoaderCircle size={14} className="animate-spin" />
              {modelName(run.model)} is working…
            </p>
          )}
          {state.error && (
            <p role="alert" className="error-banner">
              {state.error}
            </p>
          )}
          {state.status !== 'running' && (
            <TimelineSystemDivider
              label={`Pass ${state.status}`}
              tone={state.status === 'failed' ? 'danger' : 'neutral'}
            />
          )}
        </div>
      </div>
      {!atEnd && (
        <Button
          className="session-jump"
          size="sm"
          onClick={() => {
            following.current = true
            setAtEnd(true)
            viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          <ArrowDown size={14} />
          Latest output
        </Button>
      )}
    </section>
  )
}

function isResult(event: AgentEvent) {
  return event.id === 'result' && event.title === 'Result'
}

/** The model's raw JSON answer repeats the structured result that SessionResult already shows. */
function withoutEchoedResult(events: AgentEvent[]) {
  if (!events.some(isResult)) return events
  return events.filter((event) => isResult(event) || !isRawJson(event))
}

function isRawJson(event: AgentEvent) {
  if (event.kind !== 'assistant') return false
  try {
    const value: unknown = JSON.parse(event.text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

function TranscriptItem({ event }: { event: AgentEvent }) {
  if (isResult(event)) return <SessionResult text={event.text} />
  if (event.kind === 'tool')
    return (
      <details className="session-tool">
        <summary>
          <Terminal size={14} />
          {event.title || 'Tool result'}
          <span>{event.status}</span>
        </summary>
        <pre>{event.text}</pre>
      </details>
    )
  if (event.kind === 'prompt' || event.kind === 'reasoning')
    return (
      <details className="session-context">
        <summary>
          {event.kind === 'prompt' ? 'Instructions sent to the model' : 'Reasoning'}
        </summary>
        <SessionMarkdown text={event.text} />
      </details>
    )
  return (
    <article className={`session-message session-message-${event.kind}`}>
      <SessionMarkdown text={event.text} />
    </article>
  )
}
