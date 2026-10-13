import { chatSchema, continueChatSchema } from '../domain/chat'
import { defineRoute } from './contract'

/** Carry a finished review on as a T3 Code thread that starts from its result. */
export const continueInT3Code = defineRoute('POST', '/chats', {
  request: continueChatSchema,
  response: chatSchema,
})
