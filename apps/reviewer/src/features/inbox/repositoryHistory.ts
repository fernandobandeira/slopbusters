const historyKey = 'slopbusters:recent-repositories'
const lastRepositoryKey = 'slopbusters:repository'
const historyLimit = 10
type RepositoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadRepositoryHistory(storage?: RepositoryStorage): string[] {
  try {
    const source = storage ?? localStorage
    const saved: unknown = JSON.parse(source.getItem(historyKey) ?? '[]')
    const last = source.getItem(lastRepositoryKey)
    return normalizeRepositories([last, ...(Array.isArray(saved) ? saved : [])])
  } catch {
    // A corrupt history must not prevent restoring the previous single selection.
    try {
      return normalizeRepositories([(storage ?? localStorage).getItem(lastRepositoryKey)])
    } catch {
      return []
    }
  }
}

export function visitRepository(history: string[], repository: string): string[] {
  const next = normalizeRepositories([repository, ...history])
  return next.length === history.length && next.every((name, index) => name === history[index])
    ? history
    : next
}

export function saveRepositoryHistory(history: string[], storage?: RepositoryStorage): void {
  try {
    const target = storage ?? localStorage
    target.setItem(historyKey, JSON.stringify(history))
    target.setItem(lastRepositoryKey, history[0] ?? '')
  } catch {
    // Navigation remains usable if local storage is unavailable or full.
  }
}

export function createRepositoryHistoryWriter(save: (history: string[]) => Promise<unknown>) {
  let pending = Promise.resolve()
  let latest: string[] | undefined
  let saved: string | undefined
  function write(history: string[]) {
    latest = history
    const key = JSON.stringify(history)
    const next = pending.then(async () => {
      if (key === saved) return
      await save(history)
      saved = key
    })
    pending = next.catch(() => undefined)
    return next
  }
  return { write, flush: () => (latest ? write(latest) : pending) }
}

function normalizeRepositories(values: unknown[]): string[] {
  const seen = new Set<string>()
  return values
    .filter((value): value is string => {
      if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value)) return false
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, historyLimit)
}
