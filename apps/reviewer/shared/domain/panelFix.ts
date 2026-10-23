import { z } from 'zod'

/**
 * The fixes the author sent from one reviewed PR to a T3 Code thread. Saved before the launch so a
 * repeated or retried Proceed finds it instead of starting a second thread; `sent` only once the
 * thread exists and has its first message.
 */
export const fixHandoffSchema = z.object({
  /** The gate revision the author proceeded from. */
  revision: z.string(),
  /** Chosen before the launch, so a retry reuses it. */
  threadId: z.string(),
  state: z.enum(['preparing', 'sent', 'failed']),
  createdAt: z.string(),
  /** The grounded entries the thread was asked to fix. */
  entries: z.array(z.string()),
  error: z.string().optional(),
  launch: z
    .object({
      title: z.string(),
      project: z.string(),
      location: z.enum(['t3code', 'slopbusters']),
      branch: z.string(),
      worktreePath: z.string(),
      /** The PR head the panel reviewed; the worktree starts here. */
      reviewedSha: z.string(),
      baseSha: z.string(),
    })
    .optional(),
})
export type FixHandoff = z.infer<typeof fixHandoffSchema>

/** The branch a PR's fixes are committed on, beside the PR's own branch, never pushed. */
export function fixBranch(pull: { number: number }, sha: string): string {
  return `slopbusters/fix-${String(pull.number)}-${sha.slice(0, 7)}`
}
