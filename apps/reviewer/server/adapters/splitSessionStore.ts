import type { DatabaseSync } from 'node:sqlite'
import { splitSessionSchema, type SplitSession } from '../../shared/domain/split'

export function migrateSplitSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS split_sessions (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    ); PRAGMA user_version = 9; COMMIT;`)
}

/** Linus's splits of one PR into a stack. */
export class SplitSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: SplitSession): void {
    this.database
      .prepare(
        `INSERT INTO split_sessions (id, repository, url, created_at, session)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.url, session.createdAt, JSON.stringify(session))
  }
  get(id: string): SplitSession | undefined {
    const row = this.database.prepare('SELECT session FROM split_sessions WHERE id = ?').get(id)
    return row ? splitSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  /** The newest split in the repository, or of one PR. */
  latest(repository: string, url?: string): SplitSession | undefined {
    const row = url
      ? this.database
          .prepare(
            `SELECT session FROM split_sessions WHERE repository = ? AND url = ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(repository, url)
      : this.database
          .prepare(
            `SELECT session FROM split_sessions WHERE repository = ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(repository)
    return row ? splitSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
}
