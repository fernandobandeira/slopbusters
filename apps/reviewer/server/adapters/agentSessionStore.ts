import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  agentSessionSchema,
  agentRunSchema,
  agentEventSchema,
  type AgentSession,
  type AgentRun,
  type ProviderEvent,
} from '../../shared/domain/agentSession'
import { MAX_AGENT_EVENT_CHARS, MAX_AGENT_EVENT_PAGE, MAX_AGENT_SESSIONS } from '../limits'
import { UserError } from '../errors'

export class AgentSessionStore {
  private database: DatabaseSync
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(join(directory, 'reviewer.sqlite'))
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, updated_at TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_events (run_id TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run_id,id));
      CREATE INDEX IF NOT EXISTS agent_runs_session ON agent_runs(session_id);
      CREATE INDEX IF NOT EXISTS agent_events_sequence ON agent_events(run_id,sequence);`)
    this.recover()
  }
  saveSession(session: AgentSession) {
    this.database
      .prepare(
        'INSERT INTO agent_sessions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,value=excluded.value',
      )
      .run(
        session.id,
        session.repository,
        session.updatedAt,
        JSON.stringify(agentSessionSchema.parse(session)),
      )
  }
  getSession(id: string) {
    const row = this.database.prepare('SELECT value FROM agent_sessions WHERE id=?').get(id)
    if (!row) throw new UserError('This agent session is no longer available.', 404)
    return { ...agentSessionSchema.parse(JSON.parse(String(row.value))), runs: this.runs(id) }
  }
  list(repository?: string) {
    const rows = repository
      ? this.database
          .prepare(
            'SELECT id FROM agent_sessions WHERE repository=? ORDER BY updated_at DESC LIMIT ?',
          )
          .all(repository, MAX_AGENT_SESSIONS)
      : this.database
          .prepare('SELECT id FROM agent_sessions ORDER BY updated_at DESC LIMIT ?')
          .all(MAX_AGENT_SESSIONS)
    return rows.map((row) => this.getSession(String(row.id)))
  }
  saveRun(run: AgentRun) {
    this.database
      .prepare(
        'INSERT INTO agent_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(run.id, run.sessionId, JSON.stringify(run))
  }
  event(runId: string, event: ProviderEvent) {
    const sequence = Number(
      this.database
        .prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM agent_events WHERE run_id=?')
        .get(runId)?.next,
    )
    const previous = this.database
      .prepare('SELECT position,value FROM agent_events WHERE run_id=? AND id=?')
      .get(runId, event.id)
    const position = previous ? Number(previous.position) : sequence
    const prior = previous ? agentEventSchema.parse(JSON.parse(String(previous.value))) : {}
    const text =
      event.text.length > MAX_AGENT_EVENT_CHARS
        ? event.text.slice(0, MAX_AGENT_EVENT_CHARS) +
          '\n[Output truncated to the local transcript limit.]'
        : event.text
    const value = { ...prior, ...event, text, sequence, position }
    this.database
      .prepare(
        'INSERT INTO agent_events VALUES (?,?,?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET sequence=excluded.sequence,value=excluded.value',
      )
      .run(runId, event.id, sequence, position, JSON.stringify(value))
  }
  events(sessionId: string, runId: string, after: number) {
    const run = this.runs(sessionId).find((run) => run.id === runId)
    if (!run) throw new UserError('This model pass is no longer available.', 404)
    const rows = this.database
      .prepare(
        'SELECT value FROM agent_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?',
      )
      .all(runId, after, MAX_AGENT_EVENT_PAGE + 1)
    const events = rows
      .slice(0, MAX_AGENT_EVENT_PAGE)
      .map((row) => agentEventSchema.parse(JSON.parse(String(row.value))))
    return {
      run,
      events,
      cursor: events.at(-1)?.sequence ?? after,
      more: rows.length > MAX_AGENT_EVENT_PAGE,
    }
  }
  diagnostic(id: string, context: string, cause: unknown) {
    if (!/^[a-f\d-]+$/i.test(id)) throw new Error('Invalid diagnostic identity.')
    const directory = join(this.directory, 'agent-diagnostics')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const error = describeError(cause)
    writeFileSync(
      join(directory, `${id}.log`),
      `${new Date().toISOString()}\n${context}\n${error.slice(0, MAX_AGENT_EVENT_CHARS)}\n`,
      { mode: 0o600 },
    )
  }
  close() {
    this.database.close()
  }
  private runs(sessionId: string) {
    return this.database
      .prepare('SELECT value FROM agent_runs WHERE session_id=? ORDER BY rowid')
      .all(sessionId)
      .map((row) => agentRunSchema.parse(JSON.parse(String(row.value))))
  }
  private recover() {
    for (const row of this.database.prepare('SELECT id FROM agent_sessions').all()) {
      const session = this.getSession(String(row.id))
      if (session.status === 'running')
        this.saveSession({
          ...session,
          status: 'cancelled',
          progress: 'Interrupted when the app stopped.',
          updatedAt: new Date().toISOString(),
        })
      for (const run of session.runs)
        if (run.status === 'running')
          this.saveRun({ ...run, status: 'cancelled', finishedAt: new Date().toISOString() })
    }
  }
}

/** Wrapped failures keep their command output in the cause chain. */
function describeError(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause)
  const own = cause.stack ?? cause.message
  return cause.cause === undefined ? own : `${own}\nCaused by: ${describeError(cause.cause)}`
}
