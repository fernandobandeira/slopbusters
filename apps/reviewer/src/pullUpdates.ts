import type { PullRevision } from '../shared/updates'

export function watchPullUpdates<T = PullRevision>(options: {
  getRevision: (signal: AbortSignal) => Promise<T>
  onRevision: (revision: T) => void
  onError: (error: unknown) => void
  isVisible: () => boolean
}) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let checking = false

  const check = async () => {
    if (controller.signal.aborted || checking) return
    clearTimeout(timer)
    checking = true
    try {
      const revision = await options.getRevision(controller.signal)
      if (!controller.signal.aborted) options.onRevision(revision)
    } catch (error) {
      if (!controller.signal.aborted) options.onError(error)
    } finally {
      checking = false
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void check(), options.isVisible() ? 30_000 : 120_000)
      }
    }
  }
  void check()
  return {
    check: () => void check(),
    stop: () => {
      controller.abort()
      clearTimeout(timer)
    },
  }
}
