import { expect, it } from 'vitest'
import { providerEvents } from '../server/adapters/providerEvents'
import type { ProviderEvent } from '../shared/domain/agentSession'

function recorder(provider: 'codex' | 'claude') {
  const events: ProviderEvent[] = []
  const stream = providerEvents(provider, (event) => {
    events.push(event)
  })
  return {
    events,
    stream,
    send: (value: unknown) => {
      stream.write(JSON.stringify(value) + '\n')
    },
  }
}

it('buffers split JSONL, retains tool identity across updates, and flushes the final line', () => {
  const { stream, events } = recorder('codex')
  const started = JSON.stringify({
    type: 'item.started',
    item: { id: 'tool-1', type: 'command_execution', command: 'rg test' },
  })
  stream.write(started.slice(0, 17))
  expect(events).toEqual([])
  stream.write(started.slice(17) + '\n')
  stream.write(
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'tool-1',
        type: 'command_execution',
        command: 'rg test',
        aggregated_output: 'Found it',
        exit_code: 1,
      },
    }),
  )
  stream.finish()
  expect(events).toMatchObject([
    { id: 'tool-1', kind: 'tool', title: 'rg test', status: 'running' },
    { id: 'tool-1', kind: 'tool', text: 'Found it', status: 'failed' },
  ])
})
it('updates Claude text in place and connects tool results to their original calls', () => {
  const { send, stream, events } = recorder('claude')
  send({ type: 'stream_event', event: { type: 'message_start', message: { id: 'message-1' } } })
  send({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello ' },
    },
  })
  send({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'world' },
    },
  })
  send({
    type: 'assistant',
    message: {
      id: 'message-1',
      content: [
        { type: 'text', text: 'Hello world' },
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'code.ts' } },
      ],
    },
  })
  send({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'Source text' }],
    },
  })
  send({ type: 'result', structured_output: { answer: 'Inspected' } })
  expect(events.filter((event) => event.id === 'message-1:0').map((event) => event.text)).toEqual([
    'Hello ',
    'Hello world',
    'Hello world',
  ])
  expect(events.filter((event) => event.id === 'read-1')).toMatchObject([
    { title: 'Read', status: 'running' },
    { text: 'Source text', status: 'complete' },
  ])
  expect(stream.finish()).toEqual({ answer: 'Inspected' })
})
it('retains non-JSON diagnostics and lets callers validate unstructured results', () => {
  const { stream, events, send } = recorder('claude')
  stream.write('CLI startup message\n')
  send({ type: 'result', result: '{"answer":"Done"}' })
  expect(events[0]).toMatchObject({ kind: 'activity', text: 'CLI startup message' })
  expect(stream.finish()).toEqual({ answer: 'Done' })
})
