import type { DatabaseSync } from 'node:sqlite'
import type { FindingLocation as ChangeLocation } from '../../shared/domain/findings'
import {
  panelReviewSummarySchema,
  type PanelFinding,
  type PanelReviewSummary,
  type PanelSession,
} from '../../shared/domain/panel'
import { MAX_SAVED_PANEL_REVIEWS } from '../limits'

export function migratePanelSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS panel_sessions (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS panel_sessions_repository ON panel_sessions (repository, created_at);
    PRAGMA user_version = 8; COMMIT;`)
}

/** Panel reviews: several reviewers and a judge over the same PRs. */
export class PanelSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: PanelSession): void {
    this.database
      .prepare(
        `INSERT INTO panel_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  get(id: string): PanelSession | undefined {
    const row = this.database.prepare('SELECT session FROM panel_sessions WHERE id = ?').get(id)
    return row ? readSession(row.session) : undefined
  }
  /** The newest panel in a repository, or the newest that covered `url`. */
  latest(repository: string, url?: string): PanelSession | undefined {
    const row = url
      ? this.database
          .prepare(
            `SELECT session FROM panel_sessions
            WHERE repository = ? AND EXISTS (SELECT 1 FROM json_each(session, '$.urls') WHERE value = ?)
            ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(repository, url)
      : this.database
          .prepare(
            'SELECT session FROM panel_sessions WHERE repository = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
          )
          .get(repository)
    return row ? readSession(row.session) : undefined
  }
  /** The latest judged result of each PR in a repository. */
  reviews(repository: string): PanelReviewSummary[] {
    const rows = this.database
      .prepare(
        `WITH ranked AS (
          SELECT sessions.id, sessions.created_at, sessions.session, result.value,
            row_number() OVER (
              PARTITION BY json_extract(result.value, '$.pull.url')
              ORDER BY sessions.created_at DESC, sessions.rowid DESC
            ) AS rank
          FROM panel_sessions AS sessions, json_each(sessions.session, '$.results') AS result
          WHERE sessions.repository = ?
        )
        SELECT id AS sessionId, created_at AS createdAt,
          json_extract(value, '$.pull.url') AS url,
          json_extract(value, '$.pull.number') AS number,
          json_extract(value, '$.pull.headSha') AS headSha,
          json_extract(value, '$.advice.verdict') AS verdict,
          json_array_length(value, '$.advice.findings') AS findingCount,
          (SELECT json_group_array(json_extract(reviewer.value, '$.id'))
            FROM json_each(session, '$.reviewers') AS reviewer) AS reviewers
        FROM ranked WHERE rank = 1 ORDER BY created_at DESC LIMIT ?`,
      )
      .all(repository, MAX_SAVED_PANEL_REVIEWS)
    return rows.map((row) =>
      panelReviewSummarySchema.parse({
        ...row,
        reviewers: JSON.parse(String(row.reviewers)) as unknown,
      }),
    )
  }
}

/**
 * A saved session in today's shape. Findings saved before anchors point at a changed line with
 * flat `path`, `hunkId`, `line` and `side` fields; those become change anchors.
 */
function readSession(saved: unknown): PanelSession {
  const session = JSON.parse(String(saved)) as PanelSession
  const advices = [
    ...session.results.flatMap((result) => [result.advice, ...result.reviews.map((r) => r.advice)]),
    ...(session.pending?.reviews.map((review) => review.advice) ?? []),
  ]
  for (const advice of advices)
    advice?.findings.forEach((finding, index, findings) => {
      findings[index] = withAnchor(finding)
    })
  return session
}

function withAnchor<F extends PanelFinding>(finding: F): F {
  if ('anchor' in finding) return finding
  const { path, hunkId, line, side, ...rest } = finding as unknown as Omit<F, 'anchor'> &
    Pick<ChangeLocation, 'path' | 'hunkId' | 'line' | 'side'>
  return { ...rest, anchor: { kind: 'change', path, hunkId, line, side } } as unknown as F
}
