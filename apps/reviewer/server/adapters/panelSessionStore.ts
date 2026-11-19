import type { DatabaseSync } from 'node:sqlite'
import type { FindingLocation as ChangeLocation } from '../../shared/domain/findings'
import {
  panelReviewSummarySchema,
  type PanelFinding,
  type PanelReviewSummary,
} from '../../shared/domain/panel'
import {
  panelSessionSummarySchema,
  summarizePanel,
  type PanelPreparation,
  type PanelResult,
  type PanelSession,
} from '../../shared/domain/panelSession'
import { logError } from '../errors'

const MAX_SAVED_PANEL_REVIEWS = 500

export function migratePanelSessions(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS panel_sessions (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS panel_sessions_repository ON panel_sessions (repository, created_at);
    PRAGMA user_version = 8; COMMIT;`)
}

/** Move snapshots out of old sessions, and index what the polling paths look up. */
export function migratePanelStorage(database: DatabaseSync): void {
  transaction(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS panel_state (
        session_id TEXT PRIMARY KEY REFERENCES panel_sessions(id),
        summary TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS panel_preparations (
        session_id TEXT PRIMARY KEY REFERENCES panel_sessions(id), preparation TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS panel_urls (
        session_id TEXT NOT NULL REFERENCES panel_sessions(id), url TEXT NOT NULL,
        result_index INTEGER, review TEXT, PRIMARY KEY (session_id, url)
      );
    `)
    backfill(database)
    database.exec('PRAGMA user_version = 13')
  })
  try {
    // The vacuum writes the whole file through the write-ahead log; give that space back too.
    database.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (error) {
    logError('Compacting the review database after migrating panel storage', error)
  }
}

function backfill(database: DatabaseSync): void {
  const store = new PanelSessionStore(database)
  const next = database.prepare(
    'SELECT rowid, session FROM panel_sessions WHERE rowid > ? ORDER BY rowid LIMIT 1',
  )
  let row = database
    .prepare('SELECT rowid, session FROM panel_sessions ORDER BY rowid LIMIT 1')
    .get()
  while (row) {
    const { preparation, ...session } = JSON.parse(String(row.session)) as PanelSession & {
      preparation?: PanelPreparation
    }
    writeSession(database, session)
    if (preparation && session.status !== 'complete') store.savePreparation(session.id, preparation)
    row = next.get(Number(row.rowid))
  }
}

/** Panel reviews: several reviewers and a judge over the same PRs. */
export class PanelSessionStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: PanelSession): void {
    transaction(this.database, () => {
      writeSession(this.database, session)
      if (session.status === 'complete') {
        this.database.prepare('DELETE FROM panel_preparations WHERE session_id = ?').run(session.id)
      }
    })
  }
  savePreparation(id: string, preparation: PanelPreparation): void {
    this.database
      .prepare('INSERT INTO panel_preparations (session_id, preparation) VALUES (?, ?)')
      .run(id, JSON.stringify(preparation))
  }
  preparation(id: string): PanelPreparation | undefined {
    const row = this.database
      .prepare('SELECT preparation FROM panel_preparations WHERE session_id = ?')
      .get(id)
    return row ? (JSON.parse(String(row.preparation)) as PanelPreparation) : undefined
  }
  get(id: string): PanelSession | undefined {
    const row = this.database.prepare('SELECT session FROM panel_sessions WHERE id = ?').get(id)
    return row ? readSession(row.session) : undefined
  }
  state(id: string) {
    const row = this.database
      .prepare('SELECT summary, revision FROM panel_state WHERE session_id = ?')
      .get(id)
    return row && { summary: readSummary(row.summary), revision: Number(row.revision) }
  }
  /** The newest panel that covered `url`. */
  latestId(repository: string, url: string): string | undefined {
    const row = this.database
      .prepare(
        `
        SELECT sessions.id FROM panel_urls AS urls
        JOIN panel_sessions AS sessions ON sessions.id = urls.session_id
        WHERE sessions.repository = ? AND urls.url = ?
        ORDER BY sessions.created_at DESC, sessions.rowid DESC LIMIT 1
      `,
      )
      .get(repository, url)
    return row && String(row.id)
  }
  /** Rank all sessions first so a finished panel hides older work on the same PR. */
  unfinished(repository: string) {
    const rows = this.database
      .prepare(
        `
        WITH ranked AS (
          SELECT sessions.id, urls.url, urls.result_index,
            row_number() OVER (
              PARTITION BY urls.url ORDER BY sessions.created_at DESC, sessions.rowid DESC
            ) AS rank
          FROM panel_sessions AS sessions JOIN panel_urls AS urls ON urls.session_id = sessions.id
          WHERE sessions.repository = ?
        )
        SELECT ranked.url, state.summary FROM ranked
        JOIN panel_state AS state ON state.session_id = ranked.id
        WHERE ranked.rank = 1 AND ranked.result_index IS NULL AND (
          json_extract(state.summary, '$.status') IN ('running', 'partial')
          OR json_extract(state.summary, '$.stoppedUrl') = ranked.url
        )
      `,
      )
      .all(repository)
    return rows.map((row) => ({ url: String(row.url), session: readSummary(row.summary) }))
  }
  /** A PR's newest panel results, newest first, with the session each belongs to. */
  results(
    repository: string,
    url: string,
    limit: number,
  ): { session: string; createdAt: string; result: PanelResult }[] {
    const rows = this.database
      .prepare(
        `
        WITH newest AS MATERIALIZED (
          SELECT sessions.rowid AS session_row, urls.result_index
          FROM panel_urls AS urls JOIN panel_sessions AS sessions ON sessions.id = urls.session_id
          WHERE sessions.repository = ? AND urls.url = ? AND urls.result_index IS NOT NULL
          ORDER BY sessions.created_at DESC, sessions.rowid DESC LIMIT ?
        )
        SELECT sessions.id, sessions.created_at,
          json_extract(sessions.session, '$.results[' || newest.result_index || ']') AS value
        FROM newest JOIN panel_sessions AS sessions ON sessions.rowid = newest.session_row
        ORDER BY sessions.created_at DESC, sessions.rowid DESC
      `,
      )
      .all(repository, url, limit)
    return rows.map((row) => ({
      session: String(row.id),
      createdAt: String(row.created_at),
      result: JSON.parse(String(row.value)) as PanelResult,
    }))
  }
  /** The latest judged result of each PR in a repository. */
  reviews(repository: string): PanelReviewSummary[] {
    const rows = this.database
      .prepare(
        `
        WITH ranked AS (
          SELECT urls.review, sessions.created_at, sessions.rowid AS session_row,
            row_number() OVER (
              PARTITION BY urls.url ORDER BY sessions.created_at DESC, sessions.rowid DESC
            ) AS rank
          FROM panel_sessions AS sessions JOIN panel_urls AS urls ON urls.session_id = sessions.id
          WHERE sessions.repository = ? AND urls.result_index IS NOT NULL
        )
        SELECT review FROM ranked WHERE rank = 1 ORDER BY created_at DESC, session_row DESC LIMIT ?
      `,
      )
      .all(repository, MAX_SAVED_PANEL_REVIEWS)
    return rows.map((row) => panelReviewSummarySchema.parse(JSON.parse(String(row.review))))
  }
}

/** The JSON session is authoritative; every writer updates its projections in the same save. */
function writeSession(database: DatabaseSync, session: PanelSession): void {
  database
    .prepare(
      `
    INSERT INTO panel_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET session = excluded.session
  `,
    )
    .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  database
    .prepare(
      `
    INSERT INTO panel_state (session_id, summary) VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, revision = panel_state.revision + 1
  `,
    )
    .run(session.id, JSON.stringify(summarizePanel(session)))
  database.prepare('DELETE FROM panel_urls WHERE session_id = ?').run(session.id)
  const insert = database.prepare(
    'INSERT OR IGNORE INTO panel_urls (session_id, url) VALUES (?, ?)',
  )
  for (const url of session.urls) insert.run(session.id, url)
  const judge = database.prepare(`
    INSERT INTO panel_urls (session_id, url, result_index, review) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, url) DO UPDATE SET result_index = excluded.result_index, review = excluded.review
  `)
  for (const [index, result] of session.results.entries()) {
    const review: PanelReviewSummary = {
      sessionId: session.id,
      createdAt: session.createdAt,
      url: result.pull.url,
      number: result.pull.number,
      headSha: result.pull.headSha,
      verdict: result.advice.verdict,
      findingCount: result.advice.findings.length,
      reviewers: session.reviewers.map((reviewer) => reviewer.id),
    }
    judge.run(session.id, review.url, index, JSON.stringify(review))
  }
}

function transaction(database: DatabaseSync, write: () => void): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    write()
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function readSummary(saved: unknown) {
  return panelSessionSummarySchema.parse(JSON.parse(String(saved)))
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
