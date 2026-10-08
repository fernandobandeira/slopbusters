import { z } from 'zod'
import {
  linearStatusSchema,
  ticketIdentifierSchema,
  ticketSchema,
  ticketSummarySchema,
  ticketViewSchema,
} from '../domain/tickets'
import { defineRoute, urlQuery } from './contract'

export const getLinearStatus = defineRoute('GET', '/linear/status', {
  response: linearStatusSchema,
})
export const connectLinear = defineRoute('POST', '/linear/connect', {
  response: z.object({ url: z.url() }),
})
export const saveLinearKey = defineRoute('PUT', '/linear/key', {
  request: z.object({ key: z.string().trim().min(10).max(300) }).strict(),
  response: linearStatusSchema,
})
export const disconnectLinear = defineRoute('DELETE', '/linear/connection', {
  response: linearStatusSchema,
})
export const listTickets = defineRoute('GET', '/tickets', {
  query: z
    .object({ view: ticketViewSchema, after: z.string().min(1).max(500).optional() })
    .strict(),
  response: z.object({ tickets: z.array(ticketSummarySchema), next: z.string().nullable() }),
})
export const getTicket = defineRoute('GET', '/tickets/:identifier', {
  params: z.object({ identifier: ticketIdentifierSchema }),
  response: ticketSchema,
})
export const ticketForPull = defineRoute('GET', '/pull-ticket', {
  query: urlQuery,
  response: z.object({ identifier: z.string().nullable() }),
})
