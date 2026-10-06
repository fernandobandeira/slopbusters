import { agentRunSchema } from '../shared/domain/agentSession'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AgentSessionStore } from '../server/adapters/agentSessionStore'
import { AgentSessions } from '../server/features/agent-sessions/agentSessions'
import { MAX_AGENT_EVENT_CHARS, MAX_AGENT_EVENT_PAGE } from '../server/limits'
import { Provider } from '../shared/domain/types'

const id = 'a'.repeat(32)
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
let directory: string
let store: AgentSessionStore
let sessions: AgentSessions
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'agent-sessions-'))
  store = new AgentSessionStore(directory)
  sessions = new AgentSessions(store)
  sessions.start(id, 'gandalf', {
    repository: 'example/project',
    urls: ['https://github.com/example/project/pull/1'],
  })
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

it('keeps each model pass and stable transcript positions across updates and pagination', async () => {
  await sessions.run(id, { model, label: 'Primary' }, (emit) => {
    emit({ id: 'tool', kind: 'tool', title: 'Read', text: 'Opening', status: 'running' })
    emit({ id: 'answer', kind: 'assistant', text: 'Reviewed' })
    emit({ id: 'tool', kind: 'tool', text: 'Source', status: 'complete' })
    return Promise.resolve({ summary: 'Resolved' })
  })
  const run = agentRunSchema.parse(store.getSession(id).runs[0])
  const first = store.events(id, run.id, 0)
  expect(first.events.find((event) => event.id === 'tool')).toMatchObject({
    title: 'Read',
    position: 1,
    sequence: 3,
    text: 'Source',
  })
  expect(first.run.status).toBe('complete')
  const cursor = first.cursor
  store.event(run.id, { id: 'tool', kind: 'tool', text: 'Updated source' })
  expect(store.events(id, run.id, cursor).events).toMatchObject([
    { id: 'tool', position: 1, text: 'Updated source' },
  ])
  for (let index = 0; index < MAX_AGENT_EVENT_PAGE + 2; index++)
    store.event(run.id, { id: `log-${index}`, kind: 'activity', text: 'Output' })
  const page = store.events(id, run.id, cursor + 1)
  expect(page.more).toBe(true)
  expect(page.events).toHaveLength(MAX_AGENT_EVENT_PAGE)
  expect(store.events(id, run.id, page.cursor).events).toHaveLength(2)
  expect(() => store.events('wrong-session', run.id, 0)).toThrow('no longer available')
})
it('retains safe failure messages and saves the actual cause privately for diagnosis', async () => {
  await expect(
    sessions.run(id, { model, label: 'Primary' }, () =>
      Promise.reject(new Error('private provider failure')),
    ),
  ).rejects.toThrow('private provider failure')
  const run = agentRunSchema.parse(store.getSession(id).runs[0])
  expect(run.status).toBe('failed')
  expect(run.error).not.toContain('private provider failure')
  expect(readFileSync(join(directory, 'agent-diagnostics', `${run.id}.log`), 'utf8')).toContain(
    'private provider failure',
  )
})
it('recovers interrupted passes after reopening and preserves completed pass history', () => {
  store.saveRun({
    id: 'pass',
    sessionId: id,
    model,
    label: 'First',
    status: 'running',
    startedAt: new Date().toISOString(),
  })
  store.event('pass', { id: 'message', kind: 'assistant', text: 'Before restart' })
  store.close()
  store = new AgentSessionStore(directory)
  expect(store.getSession(id)).toMatchObject({
    status: 'cancelled',
    runs: [{ status: 'cancelled' }],
  })
  expect(store.events(id, 'pass', 0).events[0]?.text).toBe('Before restart')
  expect(store.list('another/repository')).toEqual([])
})
it('marks aborted model passes cancelled and discloses transcript truncation', async () => {
  await expect(
    sessions.run(id, { model, label: 'Primary' }, (emit) => {
      emit({ id: 'big', kind: 'assistant', text: 'x'.repeat(MAX_AGENT_EVENT_CHARS + 1) })
      sessions.update({ id, status: 'cancelled', progress: 'Stopped' })
      return Promise.reject(new Error('Cancelled'))
    }),
  ).rejects.toThrow('Cancelled')
  const run = agentRunSchema.parse(store.getSession(id).runs[0])
  expect(run.status).toBe('cancelled')
  expect(store.events(id, run.id, 0).events[0]?.text).toContain('[Output truncated')
})
