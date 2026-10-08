import { z } from 'zod'

/** A Linear issue key such as PRD-4745. */
export const ticketIdentifierSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/, 'Enter a Linear issue ID such as PRD-123.')

export const ticketViewSchema = z.enum(['assigned', 'created'])
export type TicketView = z.infer<typeof ticketViewSchema>
export const ticketViews: { id: TicketView; label: string }[] = [
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'created', label: 'Created by me' },
]

const stateSchema = z.object({ name: z.string(), type: z.string() })
const ticketReferenceSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  state: stateSchema,
})
export const ticketSummarySchema = ticketReferenceSchema.extend({
  priority: z.number().int(),
  updatedAt: z.string(),
  assignee: z.string().nullable(),
  team: z.object({ key: z.string(), name: z.string() }),
  project: z.string().nullable(),
  labels: z.array(z.string()),
  parent: z.string().nullable(),
  pullUrls: z.array(z.string()),
})
export const ticketPullSchema = z.object({
  url: z.string(),
  repository: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged', 'unknown']),
})
export const ticketSchema = ticketSummarySchema.extend({
  id: z.string(),
  description: z.string(),
  branchName: z.string(),
  parentTicket: ticketReferenceSchema.extend({ description: z.string() }).nullable(),
  children: z.array(ticketReferenceSchema.extend({ pullUrls: z.array(z.string()) })),
  pulls: z.array(ticketPullSchema),
})
export type TicketSummary = z.infer<typeof ticketSummarySchema>
export type TicketPull = z.infer<typeof ticketPullSchema>
export type Ticket = z.infer<typeof ticketSchema>

export const linearStatusSchema = z.object({
  connected: z.boolean(),
  method: z.enum(['oauth', 'key', 'none']),
  /** This build has a Linear OAuth application, so users can sign in with one click. */
  oauthAvailable: z.boolean(),
  connecting: z.boolean(),
  viewer: z.object({ name: z.string(), email: z.string() }).nullable(),
  detail: z.string(),
})
export type LinearStatus = z.infer<typeof linearStatusSchema>

/** Linear stores collapsible sections as `+++`, but its API returns them as `>>>`. */
export function linearMarkdown(description: string): string {
  return description.replace(/^>>>(?=[ \t]|$)/gm, '+++')
}

/** Render Linear's collapses and entity mentions as Markdown a browser can display. */
export function displayMarkdown(description: string): string {
  const lines = linearMarkdown(description).split('\n')
  const output: string[] = []
  let open = false
  for (const line of lines) {
    const marker = /^\+\+\+(?:[ \t]+(.*))?$/.exec(line)
    if (!marker) output.push(line)
    else if (open) {
      output.push('', '</details>', '')
      open = false
    } else {
      output.push(`<details><summary>${escapeHtml(marker[1]?.trim() || 'Details')}</summary>`, '')
      open = true
    }
  }
  if (open) output.push('', '</details>')
  return output
    .join('\n')
    .replace(
      /<(issue|pull-request|document|project)\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g,
      (_match, _kind: string, href: string, label: string) => `[${label}](${href})`,
    )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Find an issue key in text, for example `PRD-4745 [1/3] …`. Titles name keys in capitals;
 * branches and typed input may not, so they opt into `ignoreCase`.
 */
export function ticketIdentifierIn(
  text: string,
  options: { ignoreCase?: boolean } = {},
): string | undefined {
  const pattern = options.ignoreCase
    ? /(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9}-\d{1,7})(?![A-Za-z0-9])/
    : /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{0,9}-\d{1,7})(?![A-Za-z0-9])/
  const match = pattern.exec(text)
  const identifier = match?.[1]?.toUpperCase()
  return identifier && ticketIdentifierSchema.safeParse(identifier).success ? identifier : undefined
}
