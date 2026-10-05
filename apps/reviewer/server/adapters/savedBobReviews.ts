import type { DatabaseSync } from 'node:sqlite'
import { bobReviewSummarySchema } from '../../shared/domain/bob'
import { MAX_SAVED_BOB_REVIEWS } from '../limits'

export function readSavedBobReviews(database: DatabaseSync, repository: string) {
  const rows = database
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
