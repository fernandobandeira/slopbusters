import { agentRunSchema } from '../shared/domain/agentSession'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startReviewerServer } from '../server/app'
import { AgentSessionStore } from '../server/adapters/agentSessionStore'
import { AgentSessions } from '../server/features/agent-sessions/agentSessions'
import { Provider } from '../shared/domain/types'
import * as routes from '../shared/api/agentSessions'

it('validates session API responses, repository filters and transcript ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-api-'))
  const store = new AgentSessionStore(directory)
  const sessions = new AgentSessions(store)
  sessions.start('abc', 'bob', { repository: 'example/project', urls: [] })
  await sessions.run(
    'abc',
    { model: { provider: Provider.codex, model: 'gpt-6.1-sol' }, label: 'Review' },
    (emit) => {
      emit({ id: 'text', kind: 'assistant', text: 'Reviewed' })
      return Promise.resolve({ summary: 'Done' })
    },
  )
  sessions.update({ id: 'abc', status: 'complete', progress: 'Reviewed' })
  const runId = agentRunSchema.parse(store.getSession('abc').runs[0]).id
  store.close()
  const server = await startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
  })
  try {
    const list = routes.listAgentSessions.response.parse(
      await (await fetch(`${server.url}/api/agent-sessions?repository=example/project`)).json(),
    )
    expect(list.sessions[0]).toMatchObject({ id: 'abc', status: 'complete', runs: [{ id: runId }] })
    const detail = routes.getAgentSession.response.parse(
      await (await fetch(`${server.url}/api/agent-sessions/abc`)).json(),
    )
    expect(detail.runs).toHaveLength(1)
    const events = routes.getAgentRunEvents.response.parse(
      await (await fetch(`${server.url}/api/agent-sessions/abc/runs/${runId}?after=0`)).json(),
    )
    expect(events.events[0]?.text).toBe('Reviewed')
    expect((await fetch(`${server.url}/api/agent-sessions?repository=bad`)).status).toBe(400)
    expect(
      (await fetch(`${server.url}/api/agent-sessions/abc/runs/${runId}?after=-1`)).status,
    ).toBe(400)
    expect((await fetch(`${server.url}/api/agent-sessions/wrong/runs/${runId}`)).status).toBe(404)
    expect(
      await (await fetch(`${server.url}/api/agent-sessions?repository=another/project`)).json(),
    ).toEqual({ sessions: [] })
  } finally {
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
