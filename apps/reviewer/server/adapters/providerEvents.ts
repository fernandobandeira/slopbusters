import { z } from 'zod'
import type { ProviderObserver } from '../../shared/domain/agentSession'
import { MAX_AGENT_EVENT_CHARS } from '../limits'

const object = (value: unknown) => z.record(z.string(), z.unknown()).safeParse(value).data ?? {}
const string = (value: unknown) => (typeof value === 'string' ? value : '')

/** Normalize CLI JSONL into stable transcript items; updated items retain their identity. */
export function providerEvents(provider: 'codex' | 'claude', observer?: ProviderObserver) {
  let pending = ''
  let counter = 0
  const emit: ProviderObserver = (event) => {
    observer?.(event)
  }
  const claude = claudeEvents(emit)
  function line(text: string) {
    if (!text.trim()) return
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      emit({ id: `log-${counter++}`, kind: 'activity', text })
      return
    }
    const event = object(value)
    if (provider === 'codex') codex(event, emit)
    else claude.receive(event)
  }
  return {
    write: (chunk: string) => {
      pending += chunk
      let end: number
      while ((end = pending.indexOf('\n')) !== -1) {
        line(pending.slice(0, end))
        pending = pending.slice(end + 1)
      }
    },
    finish() {
      if (pending) line(pending)
      pending = ''
      return claude.result()
    },
  }
}

function codex(event: Record<string, unknown>, emit: ProviderObserver) {
  const item = object(event.item)
  const id = string(item.id)
  if (!id) return
  const complete = event.type === 'item.completed'
  const status = complete ? 'complete' : 'running'
  switch (item.type) {
    case 'agent_message':
      emit({ id, kind: 'assistant', text: string(item.text), status })
      break
    case 'reasoning':
      emit({ id, kind: 'reasoning', text: string(item.text), status })
      break
    case 'command_execution':
      emit({
        id,
        kind: 'tool',
        title: string(item.command),
        text: string(item.aggregated_output),
        status: item.exit_code && item.exit_code !== 0 ? 'failed' : status,
      })
      break
    case 'mcp_tool_call':
      emit({
        id,
        kind: 'tool',
        title: `${string(item.server)} · ${string(item.tool)}`,
        text: JSON.stringify(
          { arguments: item.arguments, result: item.result, error: item.error },
          null,
          2,
        ),
        status: item.error ? 'failed' : status,
      })
      break
    default:
      if (typeof item.text === 'string') emit({ id, kind: 'activity', text: item.text, status })
  }
}

function claudeMessage(id: string, content: unknown, emit: ProviderObserver) {
  if (!Array.isArray(content)) return
  content.forEach((value: unknown, index) => {
    const block = object(value)
    if (block.type === 'text' || block.type === 'thinking')
      emit({
        id: `${id}:${index}`,
        kind: block.type === 'thinking' ? 'reasoning' : 'assistant',
        text: string(block.text ?? block.thinking),
        status: 'complete',
      })
    if (block.type === 'tool_use')
      emit({
        id: string(block.id) || `${id}:${index}`,
        kind: 'tool',
        title: string(block.name),
        text: JSON.stringify(block.input, null, 2),
        status: 'running',
      })
    if (block.type === 'tool_result')
      emit({
        id: string(block.tool_use_id) || `${id}:${index}`,
        kind: 'tool',
        text:
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2),
        status: block.is_error ? 'failed' : 'complete',
      })
  })
}

function claudeEvents(emit: ProviderObserver) {
  let result: unknown
  let messageId = ''
  let counter = 0
  const partial = new Map<string, string>()
  function stream(event: Record<string, unknown>) {
    if (event.type === 'message_start')
      messageId = string(object(event.message).id) || `message-${counter++}`
    if (event.type !== 'content_block_delta') return
    const delta = object(event.delta)
    const index = typeof event.index === 'number' ? event.index : 0
    const id = `${messageId}:${index}`
    const next = ((partial.get(id) ?? '') + string(delta.text ?? delta.thinking)).slice(
      0,
      MAX_AGENT_EVENT_CHARS + 1,
    )
    partial.set(id, next)
    if (next)
      emit({
        id,
        kind: delta.type === 'thinking_delta' ? 'reasoning' : 'assistant',
        text: next,
        status: 'running',
      })
  }
  function receive(event: Record<string, unknown>) {
    if ('structured_output' in event) result = event.structured_output
    if (event.type === 'result' && typeof event.result === 'string' && result === undefined) {
      try {
        result = JSON.parse(event.result)
      } catch {
        /* The caller validates unstructured results. */
      }
    }
    if (event.type === 'assistant') {
      const message = object(event.message)
      messageId = string(message.id) || string(event.uuid) || `message-${counter++}`
      claudeMessage(messageId, message.content, emit)
      partial.clear()
    }
    if (event.type === 'stream_event') stream(object(event.event))
    if (event.type === 'user')
      claudeMessage(string(event.uuid) || `tool-${counter++}`, object(event.message).content, emit)
  }
  return { receive, result: () => result }
}
