import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api/chat'
import { call } from '../../lib/api'
import { chatDetail, chatPlace, useChatStart } from './useChatStart'
import '../../components/startReview.css'

/** Opens a conversation with Steve Jobs about this issue as a T3 Code thread. */
export function JobsChatButton({ ticket, repository }: { ticket: string; repository: string }) {
  const [error, setError] = useState<string>()
  const { starting, started, start } = useChatStart<'jobs'>(setError)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={Boolean(starting) || !repository}
        aria-label={`Chat with Steve Jobs about ${ticket}`}
        title={
          started
            ? chatDetail(started.chat)
            : repository
              ? 'Talk the issue through in a T3 Code thread'
              : 'Choose a repository for this issue first'
        }
        onClick={() => {
          setError(undefined)
          void start('jobs', () => call(routes.startTicketChat, { body: { ticket, repository } }))
        }}
      >
        <img className="review-companion-icon" src="/jobs/neutral.png" alt="" />
        {starting ? <LoaderCircle size={13} className="animate-spin" /> : null}
        {started ? <Check size={13} aria-hidden="true" /> : null}
        <span aria-live="polite">
          {starting
            ? 'Opening Steve Jobs…'
            : started
              ? `Steve Jobs is ${chatPlace(started.chat)}`
              : 'Chat with Steve Jobs'}
        </span>
      </Button>
      {error && (
        <span className="chat-error" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
