import { z } from 'zod'

/**
 * What earlier rounds of the panel asked for on a PR, and the check that a round's plans neither
 * undo one of those requests nor ask for opposite changes to the same thing. Grounding reads the
 * requests; the check, one structured turn after the debate, compares the plans with them and
 * with each other. Neither judges which side is right: a marked entry goes to the author.
 */

/** The short key a round gives an earlier request, like the `f1` keys of its sources. */
const requestKeySchema = z.string().regex(/^e\d{1,4}$/)

/** One change an earlier round asked for on this PR. */
export const earlierRequestSchema = z.object({
  key: requestKeySchema,
  /** The date the earlier round ran. */
  round: z.string(),
  /** Its id in that round, such as `#131/g4`, `d2` or `g4`. */
  entry: z.string(),
  title: z.string(),
  plan: z.string(),
  reason: z.string(),
  /** In the list the author worked from, or put to the author. */
  asked: z.enum(['fix', 'decision']),
})
export type EarlierRequest = z.infer<typeof earlierRequestSchema>

/** The requests grounding was given, newest first, and how many older ones did not fit. */
export const earlierRequestsSchema = z.object({
  requests: z.array(earlierRequestSchema),
  left: z.number().int().nonnegative(),
})
export type EarlierRequests = z.infer<typeof earlierRequestsSchema>

const reasonSchema = z.string().min(1).max(400)

/** What the check found: plans that undo an earlier request, and plans that oppose each other. */
export const consistencySchema = z
  .object({
    reversals: z
      .array(
        z
          .object({
            entry: z.string().min(1).max(40),
            earlier: requestKeySchema,
            reason: reasonSchema,
          })
          .strict(),
      )
      .max(40),
    conflicts: z
      .array(
        z
          .object({
            entries: z.array(z.string().min(1).max(40)).min(2).max(40),
            reason: reasonSchema,
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
export type Consistency = z.infer<typeof consistencySchema>

/** What the check may refer to: the entries it was given and the earlier requests' keys. */
export interface ConsistencyScope {
  entries: readonly string[]
  earlier: readonly string[]
}

/** Why a reply names something it was not given, or names an entry twice in one list. */
export function consistencyProblems(reply: Consistency, scope: ConsistencyScope): string[] {
  const problems: string[] = []
  const check = (list: string, ids: readonly string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!scope.entries.includes(id))
        problems.push(`${list}: ${id} is not an entry you were given.`)
      else if (seen.has(id)) problems.push(`${list}: ${id} is named more than once.`)
      seen.add(id)
    }
  }
  check(
    'reversals',
    reply.reversals.map((item) => item.entry),
  )
  for (const item of reply.reversals)
    if (!scope.earlier.includes(item.earlier))
      problems.push(`reversals: ${item.earlier} is not an earlier request you were given.`)
  check(
    'conflicts',
    reply.conflicts.flatMap((item) => item.entries),
  )
  return problems
}

/** The schema the check's reply must meet, with its ids checked so a bad reply is corrected. */
export function consistencyReplySchema(scope: ConsistencyScope) {
  return consistencySchema.superRefine((reply, context) => {
    for (const message of consistencyProblems(reply, scope))
      context.addIssue({ code: 'custom', message })
  })
}
