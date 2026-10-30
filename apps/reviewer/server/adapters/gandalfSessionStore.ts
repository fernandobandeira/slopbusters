import type { DatabaseSync } from 'node:sqlite'
import { gandalfSessionSchema, type GandalfSession } from '../../shared/domain/gandalf'

export function migrateGandalfSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS gandalf_sessions (
        id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
      ); PRAGMA user_version = 5; COMMIT;`)
}

/** Gandalf's resolutions of a stack's conflicts or CI failures. */
export class GandalfSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: GandalfSession): void {
    this.database
      .prepare(
        `INSERT INTO gandalf_sessions (id, repository, created_at, session)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  get(id: string): GandalfSession | undefined {
    const row = this.database.prepare('SELECT session FROM gandalf_sessions WHERE id = ?').get(id)
    return row ? gandalfSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  latest(repository: string): GandalfSession | undefined {
    const row = this.database
      .prepare(
        `SELECT session FROM gandalf_sessions WHERE repository = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(repository)
    return row ? gandalfSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  /** Each repository's newest session when it was still running, to resume after a restart. */
  pending(): GandalfSession[] {
    return this.database
      .prepare(
        `SELECT session FROM (
          SELECT session, ROW_NUMBER() OVER (
            PARTITION BY repository ORDER BY created_at DESC, rowid DESC
          ) AS position FROM gandalf_sessions
        ) WHERE position = 1 AND json_extract(session, '$.status') = 'running'`,
      )
      .all()
      .map((row) => gandalfSessionSchema.parse(JSON.parse(String(row.session))))
  }
}
