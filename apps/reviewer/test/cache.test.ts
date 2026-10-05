import { describe, expect, it, vi } from 'vitest'
import { createCache } from '../server/cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('instance-owned caches', () => {
  it('shares concurrent loads, caches completed values and retries failures', async () => {
    const cache = createCache<string>({ max: 2 })
    const pending = deferred<string>()
    const load = vi.fn(() => pending.promise)

    const first = cache.load('revision', load)
    const second = cache.load('revision', load)
    pending.resolve('source')

    expect(second).toBe(first)
    expect(await first).toBe('source')
    expect(await cache.load('revision', load)).toBe('source')
    expect(load).toHaveBeenCalledOnce()
    await expect(cache.load('missing', () => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    )
    expect(await cache.load('missing', () => Promise.resolve('recovered'))).toBe('recovered')
  })

  it('evicts the least recently used value and expires data against its own clock', () => {
    let now = 0
    const cache = createCache<string>({ max: 2, ttlMs: 10, now: () => now })
    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.get('a')

    cache.set('c', 'C')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('A')
    now = 10
    expect(cache.get('a')).toBeUndefined()
  })

  it('accounts for replacements and does not retain an oversized result', async () => {
    const cache = createCache<string>({ max: 10, maxBytes: 5, sizeOf: (value) => value.length })
    cache.set('a', 'four')
    cache.set('a', 'A')
    cache.set('b', 'four')

    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBe('four')
    expect(await cache.load('large', () => Promise.resolve('too large'))).toBe('too large')
    expect(cache.get('large')).toBeUndefined()
    expect(cache.get('b')).toBe('four')
  })

  it('keeps invalidated in-flight results out of a new cache generation', async () => {
    const cache = createCache<string>({ max: 1 })
    const old = deferred<string>()
    const request = cache.load('revision', () => old.promise)
    cache.clear()

    await cache.load('revision', () => Promise.resolve('new'))
    old.resolve('old')
    await request

    expect(cache.get('revision')).toBe('new')
  })

  it('does not share values between instances', () => {
    const first = createCache<string>({ max: 1 })
    const second = createCache<string>({ max: 1 })
    first.set('same', 'first')
    expect(second.get('same')).toBeUndefined()
  })
})
