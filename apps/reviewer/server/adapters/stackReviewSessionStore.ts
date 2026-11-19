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
    return row ? readSession(row.session) : undefined
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
    return row ? readSession(row.session) : undefined
  }
  /** The newest stack reviews that covered `url`, newest first. */
  recent(repository: string, url: string, limit: number): StackReviewSession[] {
    return this.database
      .prepare(
        `SELECT session FROM stack_review_sessions
        WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(session, '$.urls') WHERE value = ?)
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(repository, url, limit)
      .map((row) => readSession(row.session))
  }
}

interface SavedResult {
  duplicates?: { entries: string[]; owner: string }[]
  derived?: { from: string[] }[]
}
interface SavedSession {
  input?: { entries: { id: string }[]; left: string[] }
  pass?: {
    result?: SavedResult
    positions?: Partial<Record<'primary' | 'secondary', { result: SavedResult }>>
  }
}

/** Ids of earlier-round entries, which stack reviews before 0.5.29 gave the cross-layer pass. */
const earlierId = /^#\d+\/earlier\//

/**
 * A saved stack review in today's shape. Reviews saved before earlier-round entries left the
 * cross-layer pass carry them, and its results may name them; those are dropped, so the brief
 * shows what it showed, without the references to entries it never listed.
 */
function readSession(saved: unknown): StackReviewSession {
  const session = JSON.parse(String(saved)) as SavedSession
  const { input, pass } = session
  if (input) {
    input.entries = input.entries.filter((entry) => !earlierId.test(entry.id))
    input.left = input.left.filter((id) => !earlierId.test(id))
  }
  for (const result of [
    pass?.result,
    pass?.positions?.primary?.result,
    pass?.positions?.secondary?.result,
  ])
    if (result) withoutEarlier(result)
  return stackReviewSessionSchema.parse(session)
}

function withoutEarlier(result: SavedResult) {
  const current = (id: string) => !earlierId.test(id)
  result.duplicates = result.duplicates
    ?.map((group) => ({ ...group, entries: group.entries.filter(current) }))
    .filter((group) => group.entries.length > 1)
  for (const item of result.derived ?? []) item.from = item.from.filter(current)
}
