// The desktop close handler waits for SQLite writes even after navigating away from a review.
const flushers = new Map<() => Promise<void>, { retired: boolean }>()

declare global {
  interface Window {
    slopbustersFlushReviews?: () => Promise<void>
  }
}

function removeRetiredFlusher(flush: () => Promise<void>) {
  if (flushers.get(flush)?.retired) flushers.delete(flush)
  if (flushers.size === 0) delete window.slopbustersFlushReviews
}

/** A reopened review must not load an older draft while its prior window is still saving. */
export async function flushDetachedReviews(): Promise<void> {
  await Promise.all(
    [...flushers.entries()]
      .filter(([, entry]) => entry.retired)
      .map(async ([save]) => {
        await save()
        removeRetiredFlusher(save)
      }),
  )
}

export function registerReviewFlusher(flush: () => Promise<void>): () => void {
  const registration = { retired: false }
  flushers.set(flush, registration)
  window.slopbustersFlushReviews = async () => {
    await Promise.all(
      [...flushers.keys()].map(async (save) => {
        await save()
        removeRetiredFlusher(save)
      }),
    )
  }
  return () => {
    registration.retired = true
    // Navigation cannot unregister an in-flight or failed save: desktop quit must still await it.
    void flush()
      .then(() => removeRetiredFlusher(flush))
      .catch(() => {})
  }
}
