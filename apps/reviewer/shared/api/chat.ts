import { z } from 'zod'
import { chatSchema, pullChatSchema } from '../domain/chat'
import { ticketIdentifierSchema } from '../domain/tickets'
import { defineRoute, idParams } from './contract'

export const startPullChat = defineRoute('POST', '/pulls/:id/chat', {
  params: idParams,
  request: pullChatSchema,
  response: chatSchema,
})
export const startTicketChat = defineRoute('POST', '/tickets/chat', {
  request: z
    .object({
      ticket: ticketIdentifierSchema,
      repository: z
        .string()
        .max(300)
        .regex(/^[\w.-]+\/[\w.-]+$/),
    })
    .strict(),
  response: chatSchema,
})
