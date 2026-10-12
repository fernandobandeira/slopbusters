import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { EngineAccess } from './enginePairing'

const accessSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number() })

/** Bearer access to each paired T3 Code engine, keyed by its environment id. */
export class EngineCredentialStore {
  constructor(private readonly database: DatabaseSync) {}
  get(environmentId: string): EngineAccess | undefined {
    const row = this.database
      .prepare('SELECT value FROM secrets WHERE name = ?')
      .get(secretName(environmentId))
    if (!row) return undefined
    const parsed = accessSchema.safeParse(JSON.parse(String(row.value)))
    return parsed.success ? parsed.data : undefined
  }
  save(environmentId: string, access: EngineAccess | undefined): void {
    if (!access)
      this.database.prepare('DELETE FROM secrets WHERE name = ?').run(secretName(environmentId))
    else
      this.database
        .prepare(
          `INSERT INTO secrets (name, value) VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
        )
        .run(secretName(environmentId), JSON.stringify(access))
  }
}

function secretName(environmentId: string) {
  return `t3-engine:${environmentId}`
}
