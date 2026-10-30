import type { DatabaseSync } from 'node:sqlite'
import { bobReviewSummarySchema, type BobSession } from '../../shared/domain/bob'

const MAX_SAVED_BOB_REVIEWS = 500

export function migrateBobSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS bob_sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL);
    PRAGMA user_version = 4; COMMIT;`)
}

/** Uncle Bob's reviews of PRs. */
export class BobSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: BobSession): void {
    this.database
      .prepare(
        `INSERT INTO bob_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  get(id: string): BobSession | undefined {
    const row = this.database.prepare('SELECT session FROM bob_sessions WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.session)) as BobSession) : undefined
  }
  /** The newest review in a repository, or the newest that covered `url`. */
  latest(repository: string, url?: string): BobSession | undefined {
    const row = url
      ? this.database
          .prepare(
            `SELECT session FROM bob_sessions
          WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(session, '$.urls') WHERE value = ?)
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(repository, url)
      : this.database
          .prepare(
            'SELECT session FROM bob_sessions WHERE repository = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
          )
          .get(repository)
    return row ? (JSON.parse(String(row.session)) as BobSession) : undefined
  }
  /** The latest result of each PR reviewed in a repository. */
  reviews(repository: string) {
    const rows = this.database
      .prepare(
        `
    WITH ranked AS (
      SELECT sessions.id, sessions.created_at, result.value,
        row_number() OVER (
          PARTITION BY json_extract(result.value, '$.pull.url')
          ORDER BY sessions.created_at DESC, sessions.rowid DESC
        ) AS rank
      FROM bob_sessions AS sessions, json_each(sessions.session, '$.results') AS result
      WHERE sessions.repository = ?
    )
    SELECT id AS sessionId, created_at AS createdAt,
      json_extract(value, '$.pull.url') AS url,
      json_extract(value, '$.pull.number') AS number,
      json_extract(value, '$.pull.headSha') AS headSha,
      json_extract(value, '$.advice.verdict') AS verdict,
      json_array_length(value, '$.advice.findings') AS findingCount
    FROM ranked WHERE rank = 1 ORDER BY created_at DESC LIMIT ?
  `,
      )
      .all(repository, MAX_SAVED_BOB_REVIEWS)
    return rows.map((row) => bobReviewSummarySchema.parse(row))
  }
}
