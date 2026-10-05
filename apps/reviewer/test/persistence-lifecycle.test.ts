import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerReviewFlusher, flushDetachedReviews } from '../src/lib/persistenceLifecycle'

afterEach(() => vi.unstubAllGlobals())

describe('desktop review save lifecycle', () => {
  it('keeps detached reviews registered until their last write finishes', async () => {
    vi.stubGlobal('window', {})
    let resolveWrite!: () => void
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    const save = vi.fn(() => pendingWrite)
    const unmount = registerReviewFlusher(save)
    unmount()
    expect(window.slopbustersFlushReviews).toBeTypeOf('function')
    let didClose = false
    const close = window.slopbustersFlushReviews!().then(() => {
      didClose = true
    })
    await Promise.resolve()
    expect(didClose).toBe(false)
    resolveWrite()
    await close
    expect(didClose).toBe(true)
    expect(window.slopbustersFlushReviews).toBeUndefined()
  })

  it('blocks reopening a review until detached writes finish without flushing mounted reviews', async () => {
    vi.stubGlobal('window', {})
    let resolveWrite!: () => void
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    const oldSave = vi.fn(() => pendingWrite)
    registerReviewFlusher(oldSave)()
    const newSave = vi.fn(async () => {})
    const unmountNew = registerReviewFlusher(newSave)
    let didLoad = false
    const load = flushDetachedReviews().then(() => {
      didLoad = true
    })
    await Promise.resolve()
    expect(didLoad).toBe(false)
    expect(newSave).not.toHaveBeenCalled()
    resolveWrite()
    await load
    expect(didLoad).toBe(true)
    unmountNew()
    await flushDetachedReviews()
  })

  it('retains a failed detached save so desktop close can retry it', async () => {
    vi.stubGlobal('window', {})
    let fail = true
    const save = vi.fn(async () => {
      if (fail) throw new Error('SQLite temporarily unavailable')
    })
    const unmount = registerReviewFlusher(save)
    unmount()
    await Promise.resolve()
    await expect(window.slopbustersFlushReviews!()).rejects.toThrow(
      'SQLite temporarily unavailable',
    )
    expect(window.slopbustersFlushReviews).toBeTypeOf('function')
    fail = false
    await window.slopbustersFlushReviews!()
    expect(window.slopbustersFlushReviews).toBeUndefined()
  })
})
