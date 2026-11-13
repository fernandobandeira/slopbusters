import type { DatabaseSync } from 'node:sqlite'
import { layerFixSessionSchema, type LayerFixSession } from '../../shared/domain/layerFix'

export function migrateLayerFixes(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS layer_fix_sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, session TEXT NOT NULL);
    PRAGMA user_version = 12; COMMIT;`)
}

/** Retains worktree and thread identities across app restarts. */
export class LayerFixStore {
  constructor(private readonly database: DatabaseSync) {}
  save(session: LayerFixSession): void {
    this.database
      .prepare(
        `INSERT INTO layer_fix_sessions VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.createdAt, JSON.stringify(session))
  }
  get(id: string): LayerFixSession | undefined {
    const row = this.database.prepare('SELECT session FROM layer_fix_sessions WHERE id = ?').get(id)
    return row ? layerFixSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  all(): LayerFixSession[] {
    return this.database
      .prepare('SELECT session FROM layer_fix_sessions ORDER BY created_at DESC, rowid DESC')
      .all()
      .map((row) => layerFixSessionSchema.parse(JSON.parse(String(row.session))))
  }
}
