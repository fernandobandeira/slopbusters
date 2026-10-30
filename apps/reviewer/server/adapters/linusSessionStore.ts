import type { DatabaseSync } from 'node:sqlite'
import type { LinusRecommendation, LinusSession } from '../../shared/domain/linus'

export function migrateLinusSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE linus_sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL);
    PRAGMA user_version = 3; COMMIT;`)
}

/** Linus's reviews of PRs, with what he recommends for each. */
export class LinusSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: LinusSession): void {
    this.database
      .prepare(
        `INSERT INTO linus_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  get(id: string): LinusSession | undefined {
    const row = this.database.prepare('SELECT session FROM linus_sessions WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.session)) as LinusSession) : undefined
  }
  latest(repository: string): LinusSession | undefined {
    const row = this.database
      .prepare(
        'SELECT session FROM linus_sessions WHERE repository = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(repository)
    return row ? (JSON.parse(String(row.session)) as LinusSession) : undefined
  }
  /** The latest recommendation for each PR Linus reviewed in a repository. */
  recommendations(repository: string): LinusRecommendation[] {
    const rows = this.database
      .prepare(
        `
      SELECT sessions.id AS session_id, sessions.created_at,
        json_extract(result.value, '$.pull.url') AS url,
        json_extract(result.value, '$.pull.number') AS number,
        json_extract(result.value, '$.pull.headSha') AS head_sha,
        json_extract(result.value, '$.advice.verdict') AS verdict,
        json_array_length(result.value, '$.advice.steps') AS recommendation_count,
        json_type(sessions.session, '$.thenPanel') IS NOT NULL AS then_panel,
        json_extract(result.value, '$.panelSessionId') AS panel_session_id
      FROM linus_sessions AS sessions, json_each(sessions.session, '$.results') AS result
      WHERE sessions.repository = ?
      ORDER BY sessions.created_at DESC, sessions.rowid DESC
    `,
      )
      .all(repository)
    const latest = new Map<string, LinusRecommendation>()
    for (const row of rows) {
      const url = String(row.url)
      if (!latest.has(url))
        latest.set(url, {
          sessionId: String(row.session_id),
          createdAt: String(row.created_at),
          url,
          number: Number(row.number),
          headSha: String(row.head_sha),
          verdict: String(row.verdict) as LinusRecommendation['verdict'],
          recommendationCount: Number(row.recommendation_count),
          ...(row.then_panel ? { panel: row.panel_session_id ? 'started' : 'waiting' } : {}),
        })
    }
    return [...latest.values()]
  }
}
