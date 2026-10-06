import { mkdirSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { UserError } from '../errors'
import {
  emptyDraft,
  pullIdentity,
  restoreProgress,
  reviewedFingerprints,
  hunkFingerprint,
} from '../features/progress'
import type { PullRequest, ReviewDraft } from '../../shared/domain/types'
import type { Preferences } from '../../shared/domain/preferences'
import { gandalfSessionSchema, type GandalfSession } from '../../shared/domain/gandalf'
import type { BobSession } from '../../shared/domain/bob'
import { readSavedBobReviews } from './savedBobReviews'
import type { LinusRecommendation, LinusSession } from '../../shared/domain/linus'

export class ReviewNotFoundError extends UserError {
  constructor() {
    super('This review snapshot is no longer available. Open the PR again.', 404)
  }
}
export interface StoredDraft {
  draft: ReviewDraft
  exists: boolean
}

/** Instances own connections; importing this module never creates local data. */
export class ReviewerStore {
  private readonly database: DatabaseSync
  constructor({ dataDirectory }: { dataDirectory: string }) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
    const filename = join(dataDirectory, 'reviewer.sqlite')
    this.database = new DatabaseSync(filename)
    chmodSync(filename, 0o600)
    this.database.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    )
    const version = this.database.prepare('PRAGMA user_version').get()?.user_version
    if (typeof version !== 'number' || ![0, 1, 2, 3, 4, 5].includes(version)) {
      this.database.close()
      throw new Error('This review database was created by a newer app.')
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE snapshots (id TEXT PRIMARY KEY, pull_identity TEXT NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE drafts (snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id), draft TEXT NOT NULL);
        CREATE TABLE reviewed_hunks (pull_identity TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY (pull_identity, fingerprint));
        CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
        PRAGMA user_version = 1;
        COMMIT;
      `)
      this.importLegacySnapshots(join(dataDirectory, 'pulls'))
    }
    if (version === 0 || version === 1) {
      this.database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE draft_writers (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), writer_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(snapshot_id, writer_id));
        PRAGMA user_version = 2; COMMIT;`)
    }
    if (version === 0 || version === 1 || version === 2) {
      this.database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE linus_sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL);
        PRAGMA user_version = 3; COMMIT;`)
    }
    if (version < 4) {
      this.database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS bob_sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL);
        PRAGMA user_version = 4; COMMIT;`)
    }
    if (version < 5)
      this.database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS gandalf_sessions (
        id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
      ); PRAGMA user_version = 5; COMMIT;`)
  }
  savePull(pull: PullRequest): void {
    this.database
      .prepare(
        `INSERT INTO snapshots (id, pull_identity, snapshot) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot`,
      )
      .run(pull.id, pullIdentity(pull), JSON.stringify(pull))
  }
  getPull(id: string): PullRequest {
    const row = this.database.prepare('SELECT snapshot FROM snapshots WHERE id = ?').get(id)
    if (!row) throw new ReviewNotFoundError()
    const pull = JSON.parse(String(row.snapshot)) as PullRequest
    // Older snapshots saved this warning from the retired GitHub content loader.
    pull.warnings = pull.warnings.filter(
      (warning) =>
        warning !==
        'Copy matching is limited to available original content from the first 30 changed source files.',
    )
    return pull
  }
  getDraft(id: string): StoredDraft {
    const pull = this.getPull(id)
    const stored = this.database.prepare('SELECT draft FROM drafts WHERE snapshot_id = ?').get(id)
    const rows = this.database
      .prepare('SELECT fingerprint FROM reviewed_hunks WHERE pull_identity = ?')
      .all(pullIdentity(pull))
    return {
      draft: restoreProgress(
        pull,
        stored ? JSON.parse(String(stored.draft)) : emptyDraft(),
        new Set(rows.map((row) => String(row.fingerprint))),
      ),
      exists: stored != null,
    }
  }
  saveDraft(
    id: string,
    draft: ReviewDraft,
    write?: { writerId: string; sequence: number },
  ): StoredDraft {
    const pull = this.getPull(id)
    if (draft.comments.some((comment) => comment.headSha !== pull.headSha)) {
      throw new UserError('A draft comment belongs to a different PR revision.')
    }
    const fileIds = new Set(pull.files.map((file) => file.id))
    const hunkIds = new Set(pull.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)))
    if (
      draft.viewedFileIds.some((id) => !fileIds.has(id)) ||
      draft.viewedHunkIds?.some((id) => !hunkIds.has(id))
    ) {
      throw new UserError('Reviewed changes do not belong to this PR revision.')
    }
    if (write) {
      const previous = this.database
        .prepare('SELECT sequence FROM draft_writers WHERE snapshot_id = ? AND writer_id = ?')
        .get(id, write.writerId)
      if (previous && Number(previous.sequence) >= write.sequence) return this.getDraft(id)
    }
    const identity = pullIdentity(pull)
    const reviewed = reviewedFingerprints(pull, draft)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const remove = this.database.prepare(
        'DELETE FROM reviewed_hunks WHERE pull_identity = ? AND fingerprint = ?',
      )
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO reviewed_hunks (pull_identity, fingerprint) VALUES (?, ?)',
      )
      for (const file of pull.files.filter((file) => file.coverage === 'complete')) {
        for (const hunk of file.hunks) {
          const fingerprint = hunkFingerprint(file, hunk)
          if (!reviewed.has(fingerprint)) remove.run(identity, fingerprint)
        }
      }
      for (const fingerprint of reviewed) insert.run(identity, fingerprint)
      this.database
        .prepare(
          `INSERT INTO drafts (snapshot_id, draft) VALUES (?, ?)
        ON CONFLICT(snapshot_id) DO UPDATE SET draft = excluded.draft`,
        )
        .run(id, JSON.stringify(draft))
      if (write)
        this.database
          .prepare(
            'INSERT INTO draft_writers (snapshot_id, writer_id, sequence) VALUES (?, ?, ?) ON CONFLICT(snapshot_id, writer_id) DO UPDATE SET sequence = excluded.sequence',
          )
          .run(id, write.writerId, write.sequence)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getDraft(id)
  }
  getPreferences(): Preferences {
    const row = this.database.prepare('SELECT value FROM preferences WHERE id = 1').get()
    return row ? (JSON.parse(String(row.value)) as Preferences) : {}
  }
  saveLinusSession(session: LinusSession): void {
    this.database
      .prepare(
        `INSERT INTO linus_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  getLinusSession(id: string): LinusSession | undefined {
    const row = this.database.prepare('SELECT session FROM linus_sessions WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.session)) as LinusSession) : undefined
  }
  latestLinusSession(repository: string): LinusSession | undefined {
    const row = this.database
      .prepare(
        'SELECT session FROM linus_sessions WHERE repository = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(repository)
    return row ? (JSON.parse(String(row.session)) as LinusSession) : undefined
  }
  linusRecommendations(repository: string): LinusRecommendation[] {
    const rows = this.database
      .prepare(
        `
      SELECT sessions.id AS session_id, sessions.created_at,
        json_extract(result.value, '$.pull.url') AS url,
        json_extract(result.value, '$.pull.number') AS number,
        json_extract(result.value, '$.pull.headSha') AS head_sha,
        json_extract(result.value, '$.advice.verdict') AS verdict,
        json_array_length(result.value, '$.advice.steps') AS recommendation_count
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
        })
    }
    return [...latest.values()]
  }
  saveBobSession(session: BobSession): void {
    this.database
      .prepare(
        `INSERT INTO bob_sessions (id, repository, created_at, session) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  bobReviews(repository: string) {
    return readSavedBobReviews(this.database, repository)
  }
  getBobSession(id: string): BobSession | undefined {
    const row = this.database.prepare('SELECT session FROM bob_sessions WHERE id = ?').get(id)
    return row ? (JSON.parse(String(row.session)) as BobSession) : undefined
  }
  latestBobSession(repository: string, url?: string): BobSession | undefined {
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
  saveGandalfSession(session: GandalfSession): void {
    this.database
      .prepare(
        `INSERT INTO gandalf_sessions (id, repository, created_at, session)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.repository, session.createdAt, JSON.stringify(session))
  }
  getGandalfSession(id: string): GandalfSession | undefined {
    const row = this.database.prepare('SELECT session FROM gandalf_sessions WHERE id = ?').get(id)
    return row ? gandalfSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  latestGandalfSession(repository: string): GandalfSession | undefined {
    const row = this.database
      .prepare(
        `SELECT session FROM gandalf_sessions WHERE repository = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(repository)
    return row ? gandalfSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  savePreferences(preferences: Preferences): Preferences {
    const value = { ...this.getPreferences(), ...preferences }
    this.database
      .prepare(
        'INSERT INTO preferences (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      )
      .run(JSON.stringify(value))
    return value
  }
  close(): void {
    this.database.close()
  }
  private importLegacySnapshots(directory: string): void {
    if (!existsSync(directory)) return
    for (const filename of readdirSync(directory).filter((name) =>
      /^[a-zA-Z0-9-]+\.json$/.test(name),
    )) {
      try {
        const pull: PullRequest = JSON.parse(readFileSync(join(directory, filename), 'utf8'))
        if (
          typeof pull.id === 'string' &&
          typeof pull.owner === 'string' &&
          typeof pull.repo === 'string' &&
          Array.isArray(pull.files)
        )
          this.savePull(pull)
      } catch {
        // Leave damaged legacy files untouched; one file must not block the rest.
      }
    }
  }
}
