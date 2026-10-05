export interface CacheOptions<T> {
  max: number
  maxBytes?: number
  ttlMs?: number
  sizeOf?: (value: T) => number
  now?: () => number
  cacheable?: (value: T) => boolean
}

/** An instance-owned LRU cache. Failed loads are retried and concurrent loads share a promise. */
export function createCache<T>(options: CacheOptions<T>) {
  const values = new Map<string, { value: T; bytes: number; expires: number }>()
  const pending = new Map<string, Promise<T>>()
  const now = options.now ?? Date.now
  let bytes = 0
  let generation = 0

  function remove(key: string) {
    bytes -= values.get(key)?.bytes ?? 0
    values.delete(key)
  }

  function get(key: string): T | undefined {
    const entry = values.get(key)
    if (!entry) return undefined
    if (entry.expires <= now()) {
      remove(key)
      return undefined
    }
    values.delete(key)
    values.set(key, entry)
    return entry.value
  }

  function set(key: string, value: T) {
    remove(key)
    const size = options.sizeOf?.(value) ?? 0
    if (size > (options.maxBytes ?? Infinity) || options.cacheable?.(value) === false) return
    values.set(key, { value, bytes: size, expires: now() + (options.ttlMs ?? Infinity) })
    bytes += size
    while (values.size > options.max || bytes > (options.maxBytes ?? Infinity)) {
      const oldest = values.keys().next().value
      if (oldest === undefined) break
      remove(oldest)
    }
  }

  function load(key: string, loader: () => Promise<T>, refresh = false): Promise<T> {
    const active = pending.get(key)
    if (active) return active
    const cached = refresh ? undefined : get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const started = generation
    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (started === generation && pending.get(key) === request) set(key, value)
        return value
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key)
      })
    pending.set(key, request)
    return request
  }

  return {
    get,
    set,
    load,
    delete(key: string) {
      remove(key)
      pending.delete(key)
    },
    clear() {
      generation++
      values.clear()
      pending.clear()
      bytes = 0
    },
    async settled() {
      await Promise.allSettled([...pending.values()])
    },
  }
}
