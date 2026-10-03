import { afterEach, describe, expect, it, vi } from 'vitest'
import { pullHasUpdates } from '../shared/updates'
import { createRevisionChecker } from '../server/updates'
import { watchPullUpdates } from '../src/pullUpdates'
import { fixturePull } from './fixtures/pull'

afterEach(() => vi.useRealTimers())

describe('PR update detection', () => {
  it('detects new commits, base changes, and closing or merging a PR', () => {
    const pull = fixturePull()
    expect(pullHasUpdates(pull, pull)).toBe(false)
    expect(pullHasUpdates(pull, { ...pull, headSha: 'new-head' })).toBe(true)
    expect(pullHasUpdates(pull, { ...pull, baseSha: 'new-base' })).toBe(true)
    expect(pullHasUpdates(pull, { ...pull, state: 'merged' })).toBe(true)
  })

  it('shares metadata checks between revisions and tabs, then expires the cache', async () => {
    const pull = fixturePull()
    const fetchRevision = vi.fn(async () => pull)
    let now = 0
    const check = createRevisionChecker(fetchRevision, () => now)
    await Promise.all([check(pull), check({ ...pull, headSha: 'older-revision' })])
    expect(fetchRevision).toHaveBeenCalledTimes(1)
    now = 14_999
    await check(pull)
    expect(fetchRevision).toHaveBeenCalledTimes(1)
    now = 15_000
    await check(pull)
    expect(fetchRevision).toHaveBeenCalledTimes(2)
  })

  it('retries failed checks without caching failures', async () => {
    const pull = fixturePull()
    const fetchRevision = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(pull)
    const check = createRevisionChecker(fetchRevision)
    await expect(check(pull)).rejects.toThrow('Offline')
    await expect(check(pull)).resolves.toBe(pull)
  })

  it('checks immediately and slows down in a background tab', async () => {
    vi.useFakeTimers()
    let visible = true
    const getRevision = vi.fn(async () => fixturePull())
    const onRevision = vi.fn()
    const watcher = watchPullUpdates({
      getRevision,
      onRevision,
      onError: vi.fn(),
      isVisible: () => visible,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(onRevision).toHaveBeenCalledTimes(1)
    visible = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getRevision).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(119_999)
    expect(getRevision).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(getRevision).toHaveBeenCalledTimes(3)
    watcher.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getRevision).toHaveBeenCalledTimes(3)
  })

  it('avoids overlapping checks and discards responses after closing a review', async () => {
    vi.useFakeTimers()
    let finish!: (value: ReturnType<typeof fixturePull>) => void
    const onRevision = vi.fn()
    const getRevision = vi.fn(
      () =>
        new Promise<ReturnType<typeof fixturePull>>((resolve) => {
          finish = resolve
        }),
    )
    const watcher = watchPullUpdates({
      getRevision,
      onRevision,
      onError: vi.fn(),
      isVisible: () => true,
    })
    watcher.check()
    watcher.check()
    expect(getRevision).toHaveBeenCalledTimes(1)
    watcher.stop()
    finish(fixturePull())
    await vi.advanceTimersByTimeAsync(0)
    expect(onRevision).not.toHaveBeenCalled()
  })
})
