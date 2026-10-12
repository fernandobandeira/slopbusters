import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api/linus'
import type { LinusChat } from '../../../shared/domain/linus'
import { call, message } from '../../lib/api'
import '../../components/startReview.css'

const STARTED_LABEL_MS = 6000

/** Starts a conversation with Linus about this PR in the user's T3 Code. */
export function LinusChatButton({
  pullId,
  number,
  onError,
}: {
  pullId: string
  number: number
  onError: (error: string) => void
}) {
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState<LinusChat>()

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => {
      setStarted(undefined)
    }, STARTED_LABEL_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [started])

  async function start() {
    setStarting(true)
    setStarted(undefined)
    try {
      setStarted(await call(routes.startLinusChat, { params: { id: pullId } }))
    } catch (error) {
      onError(message(error))
    } finally {
      setStarting(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={starting}
      aria-label={`Chat with Linus about PR #${number} in T3 Code`}
      title={started ? startedDetail(started) : 'Opens a Linus conversation in T3 Code'}
      onClick={() => void start()}
    >
      <img className="review-companion-icon" src="/linus/neutral.png" alt="" />
      {starting ? <LoaderCircle size={13} className="animate-spin" /> : null}
      {started ? <Check size={13} aria-hidden="true" /> : null}
      <span aria-live="polite">
        {starting ? 'Opening T3 Code…' : started ? 'Linus is in T3 Code' : 'Chat with Linus'}
      </span>
    </Button>
  )
}

function startedDetail(chat: LinusChat): string {
  const where = `"${chat.title}" in ${chat.project}`
  return chat.onPullRequestHead
    ? `Started ${where}.`
    : `Started ${where}. Its worktree kept local commits or changes and may not match the PR head.`
}
