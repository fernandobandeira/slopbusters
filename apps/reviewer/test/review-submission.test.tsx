// @vitest-environment happy-dom
import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewEvent, type ReviewDraft } from '../shared/domain/types'
import { useReviewSubmission } from '../src/features/review/useReviewSubmission'
import { SubmitReviewDialog } from '../src/features/review/SubmitReviewDialog'
import { fixturePull } from './fixtures/pull'

const draft: ReviewDraft = { comments: [], viewedFileIds: [], summary: 'Please check this' }
const pull = fixturePull()
const response = () => Response.json({ id: 42, url: `${pull.url}#review-42` })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup(flush = vi.fn(async () => {})) {
  const setError = vi.fn()
  const refreshDiscussions = vi.fn(async () => {})
  const hook = renderHook(() => {
    const [current, setDraft] = useState(draft)
    const submission = useReviewSubmission(pull, {
      draft: current,
      setDraft,
      flush,
      setError,
      setNotice: vi.fn(),
      refreshDiscussions,
      setDiscussionError: vi.fn(),
    })
    return { ...submission, draft: current, setDraft }
  })
  return { ...hook, flush, setError, refreshDiscussions }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('review submission', () => {
  it.each(Object.values(ReviewEvent))(
    'publishes %s after saving the draft and clears published feedback',
    async (event) => {
      const fetch = vi.fn(() => Promise.resolve(response()))
      vi.stubGlobal('fetch', fetch)
      const hook = setup()
      act(() => {
        hook.result.current.setEvent(event)
      })
      await act(() => hook.result.current.submit())
      expect(fetch).toHaveBeenCalledWith(
        `/api/pulls/${pull.id}/reviews`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ draft, event }),
        }),
      )
      expect(hook.flush.mock.invocationCallOrder[0]).toBeLessThan(
        fetch.mock.invocationCallOrder[0] ?? 0,
      )
      expect(hook.flush).toHaveBeenCalledTimes(2)
      expect(hook.result.current.draft.summary).toBe('')
      expect(hook.result.current.submitted).toBe(`${pull.url}#review-42`)
      expect(hook.refreshDiscussions).toHaveBeenCalledOnce()
    },
  )
  it('ignores duplicate clicks and preserves edits made while GitHub is responding', async () => {
    const pending = deferred<Response>()
    const fetch = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetch)
    const hook = setup()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = hook.result.current.submit()
      void hook.result.current.submit()
    })
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })
    act(() => {
      hook.result.current.setDraft((previous) => ({ ...previous, summary: 'New feedback' }))
    })
    await act(async () => {
      pending.resolve(response())
      await first
    })
    expect(hook.result.current.draft.summary).toBe('New feedback')
    expect(hook.result.current.submitted).toBeUndefined()
  })
})

describe('submission failures and confirmation', () => {
  it('keeps feedback and skips publication when saving the draft fails', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const hook = setup(vi.fn(() => Promise.reject(new Error('Save failed'))))
    await act(() => hook.result.current.submit())
    expect(fetch).not.toHaveBeenCalled()
    expect(hook.result.current.draft).toEqual(draft)
    expect(hook.setError).toHaveBeenLastCalledWith(expect.stringContaining('Save failed'))
  })
  it('keeps feedback when GitHub rejects the review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: 'Please retry' }, { status: 503 }))),
    )
    const hook = setup()
    await act(() => hook.result.current.submit())
    expect(hook.result.current.draft).toEqual(draft)
    expect(hook.result.current.submitted).toBeUndefined()
    expect(hook.setError).toHaveBeenLastCalledWith(expect.stringContaining('Please retry'))
  })
  it('does not publish twice when saving the cleared draft fails', async () => {
    const fetch = vi.fn(() => Promise.resolve(response()))
    vi.stubGlobal('fetch', fetch)
    const flush = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Save failed'))
    const hook = setup(flush)
    await act(() => hook.result.current.submit())
    await act(() => hook.result.current.submit())
    expect(fetch).toHaveBeenCalledOnce()
    expect(hook.setError).toHaveBeenLastCalledWith(
      expect.stringContaining('Your review was submitted'),
    )
  })
  it('lets the reviewer choose approval and submit an empty summary', async () => {
    const submit = vi.fn()
    function Dialog() {
      const [event, setEvent] = useState(ReviewEvent.comment)
      return (
        <SubmitReviewDialog
          open
          pull={pull}
          draft={{ ...draft, summary: '' }}
          event={event}
          submitting={false}
          error=""
          onOpenChange={vi.fn()}
          onEventChange={setEvent}
          onSummaryChange={vi.fn()}
          onSubmit={submit}
        />
      )
    }
    render(<Dialog />)
    fireEvent.click(await screen.findByLabelText('Approve'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit approve' }))
    expect(submit).toHaveBeenCalledOnce()
  })
})
