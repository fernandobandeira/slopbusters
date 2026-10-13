import { ArrowUpRight, Check, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../shared/api/chat'
import type { ContinueChatRequest } from '../../shared/domain/chat'
import { call } from '../lib/api'
import { chatDetail, chatPlace, useChatStart } from '../lib/useChatStart'
import './startReview.css'

/**
 * Carries a finished review on as a T3 Code thread whose first message is that review, in the
 * user's T3 Code when it can take it and in Slopbusters' own engine otherwise.
 */
export function ContinueInT3CodeButton({
  request,
  disabled = false,
}: {
  request: ContinueChatRequest
  disabled?: boolean
}) {
  const { starting, started, error, start } = useChatStart()
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={starting || disabled}
        title={started ? chatDetail(started) : 'Talk this review through in a T3 Code thread'}
        onClick={() => void start(() => call(routes.continueInT3Code, { body: request }))}
      >
        {starting ? (
          <LoaderCircle size={13} className="animate-spin" />
        ) : started ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <ArrowUpRight size={13} aria-hidden="true" />
        )}
        <span aria-live="polite">
          {starting
            ? 'Opening T3 Code…'
            : started
              ? `Opened ${chatPlace(started)}`
              : 'Continue in T3 Code'}
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
