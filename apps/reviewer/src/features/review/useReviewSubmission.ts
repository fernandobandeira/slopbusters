import { useEffect, useRef, useState } from 'react'
import * as routes from '../../../shared/api'
import { clearSubmittedFeedback } from '../../../shared/domain/review'
import { ReviewEvent, type PullRequest, type ReviewDraft } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'

interface SubmissionOptions {
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
  flush: () => Promise<void>
  setError: (message: string) => void
  setNotice: (message: string) => void
  refreshDiscussions: () => Promise<void>
  setDiscussionError: (message: string) => void
}

export function useReviewSubmission(pull: PullRequest, options: SubmissionOptions) {
  const [submitOpen, setSubmitOpen] = useState(false)
  const [event, setEvent] = useState(ReviewEvent.comment)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<string>()
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function submit() {
    if (
      inFlight.current ||
      (submitted && !options.draft.summary.trim() && !options.draft.comments.length)
    )
      return
    inFlight.current = true
    setSubmitting(true)
    options.setError('')
    const submittedDraft = options.draft
    let published = false
    try {
      await options.flush()
      const result = await call(routes.submitReview, {
        params: { id: pull.id },
        body: { draft: submittedDraft, event },
      })
      published = true
      if (!mounted.current) return
      options.setDraft((previous) => clearSubmittedFeedback(previous, submittedDraft))
      setSubmitted(result.url)
      setSubmitOpen(false)
      await options.flush()
      options.setNotice('Review submitted to GitHub. Comments are now part of the discussion.')
      void options.refreshDiscussions().catch((error: unknown) => {
        options.setDiscussionError(message(error))
      })
    } catch (error) {
      if (mounted.current)
        options.setError(
          published
            ? `Your review was submitted, but saving the cleared draft failed: ${message(error)}`
            : `${message(error)} If the connection was interrupted, check GitHub before trying again.`,
        )
    } finally {
      inFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  return {
    submitOpen,
    setSubmitOpen,
    event,
    setEvent,
    submitting,
    submitted:
      options.draft.comments.length || options.draft.summary.trim() ? undefined : submitted,
    setSubmitted,
    submit,
  }
}
