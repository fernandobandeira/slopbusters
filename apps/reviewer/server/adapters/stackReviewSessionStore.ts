import type { DatabaseSync } from 'node:sqlite'
import { stackReviewSessionSchema, type StackReviewSession } from '../../shared/domain/stackReview'

export function migrateStackReviewSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS stack_review_sessions (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS stack_review_sessions_repository
      ON stack_review_sessions (repository, created_at);
    PRAGMA user_version = 11; COMMIT;`)
}

/** Stack reviews: the panel on every layer of a stack, then one pass across them. */
export class StackReviewSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: StackReviewSession): void {
    this.database
      .prepare(
        `INSERT INTO stack_review_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  get(id: string): StackReviewSession | undefined {
    const row = this.database
      .prepare('SELECT session FROM stack_review_sessions WHERE id = ?')
      .get(id)
    return row ? stackReviewSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  /** The newest stack review that covered one of `urls`. */
  latest(repository: string, urls: readonly string[]): StackReviewSession | undefined {
    const row = this.database
      .prepare(
        `SELECT session FROM stack_review_sessions
        WHERE repository = ? AND EXISTS (
          SELECT 1 FROM json_each(session, '$.urls') WHERE value IN (SELECT value FROM json_each(?))
        )
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(repository, JSON.stringify(urls))
    return row ? stackReviewSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
}
