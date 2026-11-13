import { z } from 'zod'
import { fixCheckStatuses } from '../../shared/domain/panelFix'

export const checkReply = (entries: readonly string[]) =>
  z
    .object({
      summary: z.string().trim().min(1).max(1000),
      results: z
        .array(
          z
            .object({
              entry: z.enum(entries as [string, ...string[]]),
              status: z.enum(fixCheckStatuses),
              note: z.string().trim().min(1).max(400),
              evidence: z.array(z.string().min(1).max(200)).max(4),
            })
            .strict(),
        )
        .max(40),
    })
    .strict()
    .refine(
      (reply) =>
        reply.results.length === entries.length &&
        new Set(reply.results.map((result) => result.entry)).size === entries.length,
      { message: 'Give exactly one result for every fix that was sent.' },
    )

export const checkRubric = `A coding agent was asked to apply the plans below to a PR and commit them. You are a second model checking its work; you did not write it. For every plan, read the committed code yourself and say whether it was applied: applied when the change does what the plan says, partial when some of it is missing, missing when nothing was done, wrong when the change does something else or breaks what the plan meant to keep. note says what you saw in one or two sentences; evidence cites path:line. Judge only these plans; do not review the rest of the PR.`
