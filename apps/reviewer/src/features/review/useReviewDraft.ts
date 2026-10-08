import type { ReviewChanges } from '../../../shared/domain/reviewChanges'
import * as routes from '../../../shared/api'
import { routeUrl } from '../../../shared/api/contract'
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type { PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { call, message } from '../../lib/api'
import { registerReviewFlusher, flushDetachedReviews } from '../../lib/persistenceLifecycle'
import { draftKey, loadDraft, restoreDraft } from './drafts'

function browserDraft(pull: PullRequest): ReviewDraft {
  try {
    const current = localStorage.getItem(draftKey(pull))
    const legacy = localStorage.getItem(draftKey(pull).replace('slopbusters:', 'review-room:'))
    if (current || legacy) {
      const value = JSON.parse(current ?? legacy!)
      const restored = restoreDraft(pull, value)
      return {
        ...restored,
        viewedHunkIds:
          restored.viewedHunkIds ??
          pull.files
            .filter((file) => restored.viewedFileIds.includes(file.id))
            .flatMap((file) => file.hunks.map((hunk) => hunk.id)),
      }
    }
  } catch {
    /* A damaged browser backup must not block SQLite recovery. */
  }
  return loadDraft(pull)
}

/** ReviewWorkspace is keyed by pull.id so each hook instance owns one immutable revision. */
export function useReviewDraft(pull: PullRequest) {
  const [draft, setDraftState] = useState<ReviewDraft>(() => browserDraft(pull))
  const [changes, setChanges] = useState<ReviewChanges>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writerId] = useState(() => crypto.randomUUID())
  const latest = useRef(draft)
  const edits = useRef(0)
  const loaded = useRef(false)
  const active = useRef(true)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const key = draftKey(pull)
  const pendingKey = `${key}:pending`
  const endpoint = routeUrl(routes.saveDraft, { params: { id: pull.id } })

  const enqueue = useCallback(
    (value: ReviewDraft, sequence: number) => {
      const write = queue.current
        .catch(() => {})
        .then(async () => {
          await call(
            routes.saveDraft,
            { params: { id: pull.id }, body: value },
            {
              headers: { 'X-Review-Writer': writerId, 'X-Review-Sequence': String(sequence) },
            },
          )
          if (sequence === edits.current) {
            try {
              localStorage.removeItem(pendingKey)
            } catch {
              /* SQLite remains authoritative. */
            }
            if (active.current) setError(null)
          }
        })
        .catch((cause: unknown) => {
          if (active.current)
            setError(
              `Could not save this review: ${message(cause)} Your browser backup is retained.`,
            )
          throw cause
        })
      queue.current = write
      // React setters cannot expose a promise; flush exposes failures to navigation and submit.
      void write.catch(() => {})
      return write
    },
    [pull.id, pendingKey, writerId],
  )

  const setDraft = useCallback(
    (action: SetStateAction<ReviewDraft>) => {
      const value = typeof action === 'function' ? action(latest.current) : action
      latest.current = value
      const sequence = ++edits.current
      setDraftState(value)
      try {
        localStorage.setItem(key, JSON.stringify(value))
        localStorage.setItem(pendingKey, 'true')
      } catch {
        setError(
          'The browser backup is unavailable. Keep this window open until the review is saved.',
        )
      }
      if (loaded.current) void enqueue(value, sequence)
    },
    [enqueue, key, pendingKey],
  )

  useEffect(() => {
    active.current = true
    let cancelled = false
    void flushDetachedReviews()
      .then(() => call(routes.getDraft, { params: { id: pull.id } }))
      .then(async (stored) => {
        if (cancelled) return
        let hasLegacy = false
        let hasPending = false
        try {
          hasLegacy =
            localStorage.getItem(key) != null ||
            localStorage.getItem(key.replace('slopbusters:', 'review-room:')) != null
          hasPending = localStorage.getItem(pendingKey) === 'true'
        } catch {
          /* The SQLite draft can load even when browser storage is disabled. */
        }
        setChanges(stored.changes)
        const useBrowser = edits.current > 0 || hasPending || (!stored.exists && hasLegacy)
        const value = useBrowser ? latest.current : stored.draft
        latest.current = value
        setDraftState(value)
        loaded.current = true
        setReady(true)
        if (useBrowser) await enqueue(value, edits.current)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`Could not load this review: ${message(cause)}`)
      })
    return () => {
      cancelled = true
      active.current = false
    }
  }, [pull.id, enqueue, key, pendingKey])

  useEffect(() => {
    const saveOnClose = () => {
      if (!loaded.current) return
      // The writer sequence makes this final request safe even when an older PUT is in flight.
      void fetch(endpoint, {
        method: 'PUT',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-Review-Writer': writerId,
          'X-Review-Sequence': String(edits.current),
        },
        body: JSON.stringify(latest.current),
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', saveOnClose)
    return () => {
      window.removeEventListener('beforeunload', saveOnClose)
    }
  }, [endpoint, writerId])

  const flush = useCallback(async () => {
    if (!loaded.current)
      throw new Error('The review draft has not finished loading. Try again once it has loaded.')
    // Retrying the latest value also recovers after a previous failed write.
    await enqueue(latest.current, edits.current)
  }, [enqueue])

  useEffect(
    () =>
      registerReviewFlusher(async () => {
        if (!loaded.current && edits.current === 0) return
        await flush()
      }),
    [flush],
  )

  return { draft, setDraft, ready, error, flush, changes }
}
