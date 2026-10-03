import { mkdirSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  emptyDraft,
  pullIdentity,
  restoreProgress,
  reviewedFingerprints,
  hunkFingerprint,
} from '../shared/progress'
import type { PullRequest, ReviewDraft } from '../shared/types'

export class ReviewNotFoundError extends Error {
  constructor() {
    super('This review snapshot is no longer available. Open the PR again.')
  }
}
export interface StoredDraft {
  draft: ReviewDraft
  exists: boolean
}
export interface Preferences {
  theme?: string
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
    if (version !== 0 && version !== 1 && version !== 2) {
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
    if (version !== 2) {
      this.database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE draft_writers (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), writer_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(snapshot_id, writer_id));
        PRAGMA user_version = 2; COMMIT;`)
    }
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
    return JSON.parse(String(row.snapshot)) as PullRequest
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
      throw new Error('A draft comment belongs to a different PR revision.')
    }
    const fileIds = new Set(pull.files.map((file) => file.id))
    const hunkIds = new Set(pull.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)))
    if (
      draft.viewedFileIds.some((id) => !fileIds.has(id)) ||
      draft.viewedHunkIds?.some((id) => !hunkIds.has(id))
    ) {
      throw new Error('Reviewed changes do not belong to this PR revision.')
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
