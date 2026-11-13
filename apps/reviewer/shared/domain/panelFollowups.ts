import { z } from 'zod'

export const followUpTicketSchema = z.object({
  entry: z.string(),
  identifier: z.string(),
  url: z.string(),
  filedAt: z.string(),
})
export type FollowUpTicket = z.infer<typeof followUpTicketSchema>
export const followUpTeamSchema = z.object({ id: z.string(), name: z.string(), key: z.string() })
export const followUpOptionsSchema = z.object({
  teams: z.array(followUpTeamSchema),
  linked: z
    .object({
      id: z.string(),
      identifier: z.string(),
      url: z.string(),
      team: followUpTeamSchema,
    })
    .nullable(),
})
export type FollowUpOptions = z.infer<typeof followUpOptionsSchema>
