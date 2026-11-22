import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { stackRecordSchema, type StackRecord } from '../../shared/domain/stackReviewRecords'
import { UserError } from '../errors'

export function migrateStackReviewRecords(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS stack_review_records (
      stack_session_id TEXT NOT NULL REFERENCES stack_review_sessions(id),
      record_kind TEXT NOT NULL CHECK (record_kind IN ('decision', 'serious_claim')),
      item_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      source_pr INTEGER NOT NULL,
      target_pr INTEGER,
      revision INTEGER NOT NULL CHECK (revision > 0),
      updated_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      answer_json TEXT,
      disposition_json TEXT,
      PRIMARY KEY (stack_session_id, record_kind, item_id)
    );
    CREATE INDEX IF NOT EXISTS stack_review_records_source ON stack_review_records (repository, source_pr);
    CREATE INDEX IF NOT EXISTS stack_review_records_target ON stack_review_records (repository, target_pr);
    PRAGMA user_version = 14; COMMIT;`)
}

export class StackReviewRecordStore {
  constructor(private readonly database: DatabaseSync) {}

  /** Only earlier reviews with the same ordered PR membership can supply carry-over. */
  read(id: string): StackRecord[] {
    return this.database
      .prepare(
        `
      SELECT r.* FROM stack_review_sessions current
      JOIN stack_review_sessions prior ON prior.repository = current.repository
        AND (prior.created_at, prior.rowid) <= (current.created_at, current.rowid)
        AND json_extract(prior.session, '$.urls') = json_extract(current.session, '$.urls')
      JOIN stack_review_records r ON r.stack_session_id = prior.id
      WHERE current.id = ? AND (prior.id = current.id OR r.record_kind = 'decision')
      ORDER BY prior.created_at DESC, prior.rowid DESC, r.item_id
    `,
      )
      .all(id)
      .map(readRecord)
  }

  write(records: StackRecord[]): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) this.writeOne(record)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private writeOne(record: StackRecord) {
    const {
      sessionId,
      kind,
      itemId,
      repository,
      sourcePr,
      targetPr,
      revision,
      updatedAt,
      snapshot,
      answer,
      disposition,
    } = record
    const change = this.database
      .prepare(
        `
      INSERT INTO stack_review_records (
        stack_session_id, record_kind, item_id, repository, source_pr, target_pr,
        revision, updated_at, snapshot_json, answer_json, disposition_json
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? = 1 OR EXISTS (
        SELECT 1 FROM stack_review_records WHERE stack_session_id = ? AND record_kind = ? AND item_id = ?
      )
      ON CONFLICT (stack_session_id, record_kind, item_id) DO UPDATE SET
        target_pr = excluded.target_pr, revision = excluded.revision, updated_at = excluded.updated_at,
        snapshot_json = excluded.snapshot_json, answer_json = excluded.answer_json,
        disposition_json = excluded.disposition_json
      WHERE stack_review_records.revision = excluded.revision - 1
    `,
      )
      .run(
        sessionId,
        kind,
        itemId,
        repository,
        sourcePr,
        targetPr,
        revision,
        updatedAt,
        JSON.stringify(snapshot),
        answer && JSON.stringify(answer),
        disposition && JSON.stringify(disposition),
        revision,
        sessionId,
        kind,
        itemId,
      )
    if (!change.changes)
      throw new UserError('This record changed in another tab. Reload it and try again.', 409)
  }
}

function readRecord(row: Record<string, SQLOutputValue>): StackRecord {
  return stackRecordSchema.parse({
    sessionId: row.stack_session_id,
    kind: row.record_kind,
    itemId: row.item_id,
    repository: row.repository,
    sourcePr: row.source_pr,
    targetPr: row.target_pr,
    revision: row.revision,
    updatedAt: row.updated_at,
    snapshot: parseJson(row.snapshot_json),
    answer: parseJson(row.answer_json),
    disposition: parseJson(row.disposition_json),
  })
}

function parseJson(value: SQLOutputValue | undefined): unknown {
  return typeof value === 'string' ? JSON.parse(value) : null
}
