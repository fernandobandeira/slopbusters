import { useEffect, useState } from 'react'
import type { Chat } from '../../shared/domain/chat'
import { message } from './api'

const STARTED_LABEL_MS = 6000

/** Starts a chat and remembers it briefly, so the button can say where it opened. */
export function useChatStart() {
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState<Chat>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => {
      setStarted(undefined)
    }, STARTED_LABEL_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [started])

  async function start(open: () => Promise<Chat>) {
    setStarting(true)
    setStarted(undefined)
    setError(undefined)
    try {
      setStarted(await open())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setStarting(false)
    }
  }

  return { starting, started, error, start }
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
