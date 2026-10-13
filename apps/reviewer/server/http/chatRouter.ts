import { Router } from 'express'
import * as routes from '../../shared/api/chat'
import type { Services } from '../services'
import { handle } from './contractRouter'

export function chatRouter({ chats }: Services) {
  const router = Router()
  handle(router, routes.continueInT3Code, ({ body }) => chats.continueInT3Code(body))
  return router
}
