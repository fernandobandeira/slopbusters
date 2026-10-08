import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  jobsReviewSummarySchema,
  jobsSessionSchema,
  type JobsReviewSummary,
  type JobsSession,
} from '../../shared/domain/jobs'
import { MAX_SAVED_JOBS_REVIEWS } from '../limits'

export const linearCredentialsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('key'), key: z.string().min(1) }),
  z.object({
    kind: z.literal('oauth'),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number(),
  }),
])
export type LinearCredentials = z.infer<typeof linearCredentialsSchema>

export function migrateTicketStore(database: DatabaseSync): void {
  database.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs_sessions (
      id TEXT PRIMARY KEY, ticket TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_sessions_ticket ON jobs_sessions (ticket, created_at);
    PRAGMA user_version = 7; COMMIT;`)
}

/** Linear credentials and Jobs ticket reviews. Secrets never travel with preferences. */
export class TicketStore {
  constructor(private readonly database: DatabaseSync) {}
  linearCredentials(): LinearCredentials | undefined {
    const row = this.database.prepare("SELECT value FROM secrets WHERE name = 'linear'").get()
    if (!row) return undefined
    const parsed = linearCredentialsSchema.safeParse(JSON.parse(String(row.value)))
    return parsed.success ? parsed.data : undefined
  }
  saveLinearCredentials(credentials: LinearCredentials | undefined): void {
    if (!credentials) this.database.prepare("DELETE FROM secrets WHERE name = 'linear'").run()
    else
      this.database
        .prepare(
          `INSERT INTO secrets (name, value) VALUES ('linear', ?)
          ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
        )
        .run(JSON.stringify(credentials))
  }
  saveJobsSession(session: JobsSession): void {
    this.database
      .prepare(
        `INSERT INTO jobs_sessions (id, ticket, created_at, session) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET session = excluded.session`,
      )
      .run(session.id, session.ticket, session.createdAt, JSON.stringify(session))
  }
  getJobsSession(id: string): JobsSession | undefined {
    const row = this.database.prepare('SELECT session FROM jobs_sessions WHERE id = ?').get(id)
    return row ? jobsSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  latestJobsSession(ticket: string): JobsSession | undefined {
    const row = this.database
      .prepare(
        `SELECT session FROM jobs_sessions WHERE ticket = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(ticket)
    return row ? jobsSessionSchema.parse(JSON.parse(String(row.session))) : undefined
  }
  runningJobsSessions(): JobsSession[] {
    return this.database
      .prepare(
        `SELECT session FROM jobs_sessions WHERE json_extract(session, '$.status') = 'running'`,
      )
      .all()
      .map((row) => jobsSessionSchema.parse(JSON.parse(String(row.session))))
  }
  /** The latest completed review per ticket, for readiness badges in the issue list. */
  jobsReviews(): JobsReviewSummary[] {
    return this.database
      .prepare(
        `WITH ranked AS (
          SELECT id, ticket, created_at, session, row_number() OVER (
            PARTITION BY ticket ORDER BY created_at DESC, rowid DESC
          ) AS rank
          FROM jobs_sessions WHERE json_array_length(session, '$.revisions') > 0
        ), latest AS (
          SELECT id, ticket, created_at, session,
            json_extract(session, '$.revisions[#-1].advice') AS advice
          FROM ranked WHERE rank = 1
        )
        SELECT ticket, id AS sessionId, created_at AS createdAt,
          json_extract(advice, '$.verdict') AS verdict,
          json_array_length(advice, '$.questions') AS questionCount,
          json_array_length(advice, '$.findings') AS findingCount,
          json_type(session, '$.applied') IS NOT NULL AS applied
        FROM latest ORDER BY created_at DESC LIMIT ?`,
      )
      .all(MAX_SAVED_JOBS_REVIEWS)
      .map((row) => jobsReviewSummarySchema.parse({ ...row, applied: Boolean(row.applied) }))
  }
}
