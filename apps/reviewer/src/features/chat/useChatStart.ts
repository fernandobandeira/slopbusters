import { useEffect, useState } from 'react'
import type { Chat } from '../../../shared/domain/chat'
import { message } from '../../lib/api'

const STARTED_LABEL_MS = 6000

/** Starts a chat and remembers it briefly, so the button can say where it opened. */
export function useChatStart<Persona extends string>(onError: (error: string) => void) {
  const [starting, setStarting] = useState<Persona>()
  const [started, setStarted] = useState<{ persona: Persona; chat: Chat }>()

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => {
      setStarted(undefined)
    }, STARTED_LABEL_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [started])

  async function start(persona: Persona, open: () => Promise<Chat>) {
    setStarting(persona)
    setStarted(undefined)
    try {
      setStarted({ persona, chat: await open() })
    } catch (error) {
      onError(message(error))
    } finally {
      setStarting(undefined)
    }
  }

  return { starting, started, start }
}

/** Where the chat opened, for the button's label. */
export function chatPlace(chat: Chat): string {
  return chat.location === 't3code' ? 'in T3 Code' : 'in a Slopbusters chat'
}

export function chatDetail(chat: Chat): string {
  const where = `Started "${chat.title}" in ${chat.project} ${chatPlace(chat)}.`
  return chat.onPullRequestHead === false
    ? `${where} Its worktree kept local commits or changes and may not match the PR head.`
    : where
}
