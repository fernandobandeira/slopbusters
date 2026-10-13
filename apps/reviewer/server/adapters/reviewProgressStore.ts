import type { DatabaseSync } from 'node:sqlite'
import { sectionedPull, splitChangeSections } from '../../shared/domain/changeSections'
import type { PullRequest } from '../../shared/domain/types'
import type { ReviewChanges } from '../../shared/domain/reviewChanges'
import { hunkFingerprint, legacyHunkFingerprint, pullIdentity } from '../features/progress'
import { compareReviewSections } from '../features/sectionComparison'

/** Expand only evidence that the previous release actually persisted as reviewed. */
export function migrateReviewProgress(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS review_baselines (
      snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id),
      baseline_id TEXT REFERENCES snapshots(id)
    );`)
  try {
    for (const row of database.prepare('SELECT snapshot FROM snapshots').all()) {
      migratePullEvidence(database, JSON.parse(String(row.snapshot)) as PullRequest)
    }
    database.exec('PRAGMA user_version = 6; COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function migratePullEvidence(database: DatabaseSync, pull: PullRequest): void {
  const identity = pullIdentity(pull)
  const reviewed = new Set(
    database
      .prepare('SELECT fingerprint FROM reviewed_hunks WHERE pull_identity = ?')
      .all(identity)
      .map((item) => String(item.fingerprint)),
  )
  const legacyCounts = new Map<string, number>()
  const sectionCounts = new Map<string, number>()
  for (const file of pull.files)
    for (const hunk of file.hunks) {
      increment(legacyCounts, legacyHunkFingerprint(file, hunk))
      for (const section of splitChangeSections(hunk))
        increment(sectionCounts, hunkFingerprint(file, section))
    }
  const insert = database.prepare(
    'INSERT OR IGNORE INTO reviewed_hunks (pull_identity, fingerprint) VALUES (?, ?)',
  )
  for (const file of pull.files.filter((file) => file.coverage === 'complete')) {
    for (const hunk of file.hunks) {
      const key = legacyHunkFingerprint(file, hunk)
      if (!reviewed.has(key) || legacyCounts.get(key) !== 1) continue
      const keys = splitChangeSections(hunk).map((section) => hunkFingerprint(file, section))
      for (const fingerprint of keys.filter((fingerprint) => sectionCounts.get(fingerprint) === 1))
        insert.run(identity, fingerprint)
    }
  }
}
function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/**
 * A draft is saved as soon as a revision is opened, so only a draft with something in it counts
 * as a review: a comment, a summary, or a viewed file or section.
 */
const REVIEWED_DRAFT = `(
  coalesce(json_array_length(drafts.draft, '$.comments'), 0) > 0
  OR trim(coalesce(json_extract(drafts.draft, '$.summary'), '')) <> ''
  OR coalesce(json_array_length(drafts.draft, '$.viewedFileIds'), 0) > 0
  OR coalesce(json_array_length(drafts.draft, '$.viewedHunkIds'), 0) > 0
)`

/** Pin the prior reviewed revision once per snapshot, so reading the new revision does
 * not silently consume its update summary. Regrouping leaves this baseline alone. */
export function readReviewChanges(
  database: DatabaseSync,
  pull: PullRequest,
): ReviewChanges | undefined {
  database
    .prepare('INSERT OR IGNORE INTO review_baselines (snapshot_id, baseline_id) VALUES (?, ?)')
    .run(pull.id, priorReview(database, pull) ?? null)
  // Baselines pinned before a draft had to hold a review may point at a revision only opened.
  if (pinnedBaselineUnreviewed(database, pull.id))
    database
      .prepare('UPDATE review_baselines SET baseline_id = ? WHERE snapshot_id = ?')
      .run(priorReview(database, pull) ?? null, pull.id)
  const row = database
    .prepare(
      `
    SELECT snapshots.snapshot FROM review_baselines
    JOIN snapshots ON snapshots.id = review_baselines.baseline_id
    WHERE review_baselines.snapshot_id = ?
  `,
    )
    .get(pull.id)
  return row
    ? compareReviewSections(sectionedPull(JSON.parse(String(row.snapshot)) as PullRequest), pull)
    : undefined
}

/** The latest earlier revision of this PR that the user reviewed. */
function priorReview(database: DatabaseSync, pull: PullRequest): string | undefined {
  const row = database
    .prepare(
      `
    SELECT snapshots.id FROM snapshots JOIN drafts ON drafts.snapshot_id = snapshots.id
    WHERE snapshots.pull_identity = ?
      AND snapshots.rowid < (SELECT rowid FROM snapshots WHERE id = ?)
      AND (json_extract(snapshot, '$.headSha') <> ? OR json_extract(snapshot, '$.baseSha') <> ?)
      AND ${REVIEWED_DRAFT}
    ORDER BY snapshots.rowid DESC LIMIT 1
  `,
    )
    .get(pullIdentity(pull), pull.id, pull.headSha, pull.baseSha)
  return row ? String(row.id) : undefined
}

function pinnedBaselineUnreviewed(database: DatabaseSync, snapshotId: string): boolean {
  return Boolean(
    database
      .prepare(
        `
    SELECT 1 FROM review_baselines
    LEFT JOIN drafts ON drafts.snapshot_id = review_baselines.baseline_id
    WHERE review_baselines.snapshot_id = ? AND review_baselines.baseline_id IS NOT NULL
      AND (drafts.draft IS NULL OR NOT ${REVIEWED_DRAFT})
  `,
      )
      .get(snapshotId),
  )
}

/** Dismissing updates clears this snapshot's baseline; later revisions compare with it again. */
export function dismissReviewChanges(database: DatabaseSync, snapshotId: string): void {
  database
    .prepare(
      `INSERT INTO review_baselines (snapshot_id, baseline_id) VALUES (?, NULL)
      ON CONFLICT(snapshot_id) DO UPDATE SET baseline_id = NULL`,
    )
    .run(snapshotId)
}
