/**
 * A fixed number of places for flow jobs to run at the same time. A job waits for a free place
 * in the order it asked, gives up its turn when its signal aborts, and frees the place once done.
 */
export class Slots {
  private free: number
  private readonly waiting: (() => void)[] = []
  constructor(limit: number) {
    this.free = limit
  }

  /** Resolve with the function that frees the place, once one is free; reject on abort. */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.free > 0) {
      this.free--
      return Promise.resolve(this.releaser())
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', abort)
        resolve(this.releaser())
      }
      const abort = () => {
        this.waiting.splice(this.waiting.indexOf(grant), 1)
        reject(signal.reason as Error)
      }
      this.waiting.push(grant)
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /**
   * Run `work` in a free place. When it must wait, `waiting` hears so first, and the function it
   * returns hears when the wait is over.
   */
  async run<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
    waiting?: () => () => void,
  ): Promise<T> {
    const turn = this.free === 0 ? waiting?.() : undefined
    const release = await this.acquire(signal)
    try {
      turn?.()
      return await work()
    } finally {
      release()
    }
  }

  private releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiting.shift()
      if (next) next()
      else this.free++
    }
  }
}

/**
 * What a session says while it waits for a place: it is marked queued with `progress`, and once
 * its turn comes, it goes back to what it said before.
 */
export function queuedNotice(
  session: { progress: string; queued?: boolean },
  progress: string,
  save: () => void,
): () => () => void {
  return () => {
    const before = session.progress
    session.queued = true
    session.progress = progress
    save()
    return () => {
      session.queued = undefined
      session.progress = before
      save()
    }
  }
}
