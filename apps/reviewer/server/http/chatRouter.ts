import { Router } from 'express'
import * as routes from '../../shared/api/chat'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function chatRouter({ chats }: Services) {
  const router = Router()
  handle(router, routes.startPullChat, ({ params, body }) => chats.startPullChat(params.id, body))
  handle(router, routes.startTicketChat, ({ body }) =>
    chats.startTicketChat(body.ticket, body.repository),
  )
  return router
}
