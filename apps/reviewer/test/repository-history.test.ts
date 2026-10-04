import { describe, expect, it } from 'vitest'
import {
  loadRepositoryHistory,
  saveRepositoryHistory,
  visitRepository,
} from '../src/repositoryHistory'

function storage(values: Record<string, string> = {}) {
  const saved = new Map(Object.entries(values))
  return {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value)
    },
  }
}

describe('repository visit history', () => {
  it('migrates the previous selection and restores the most recent visit after reopening', () => {
    const saved = storage({ 'slopbusters:repository': 'owner/first' })
    const initial = loadRepositoryHistory(saved)
    expect(initial).toEqual(['owner/first'])

    const visited = visitRepository(initial, 'owner/second')
    saveRepositoryHistory(visited, saved)

    expect(loadRepositoryHistory(saved)).toEqual(['owner/second', 'owner/first'])
    expect(saved.getItem('slopbusters:repository')).toBe('owner/second')
  })

  it('promotes revisits without duplicating repository names, including case variants', () => {
    const history = ['owner/second', 'Owner/First', 'other/repo']
    const revisited = visitRepository(history, 'owner/first')
    expect(revisited).toEqual(['owner/first', 'owner/second', 'other/repo'])
    expect(visitRepository(revisited, 'owner/first')).toBe(revisited)
  })

  it('bounds history to ten repositories and drops invalid persisted values', () => {
    const history = Array.from({ length: 12 }, (_, index) => `owner/repo-${index}`)
    const saved = storage({
      'slopbusters:recent-repositories': JSON.stringify([
        null,
        3,
        '../bad/path',
        'invalid',
        ...history,
      ]),
    })
    expect(loadRepositoryHistory(saved)).toEqual(history.slice(0, 10))
    expect(visitRepository(loadRepositoryHistory(saved), 'external/from-link')).toEqual([
      'external/from-link',
      ...history.slice(0, 9),
    ])
  })

  it('recovers the previous selection when history is corrupted', () => {
    const saved = storage({
      'slopbusters:repository': 'owner/previous',
      'slopbusters:recent-repositories': '{broken',
    })
    expect(loadRepositoryHistory(saved)).toEqual(['owner/previous'])
    expect(loadRepositoryHistory(storage({ 'slopbusters:recent-repositories': 'null' }))).toEqual(
      [],
    )
  })

  it('keeps navigation usable when storage cannot be read or written', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('Storage unavailable')
      },
      setItem: () => {
        throw new Error('Storage full')
      },
    }
    expect(loadRepositoryHistory(unavailable)).toEqual([])
    expect(() => saveRepositoryHistory(['owner/repo'], unavailable)).not.toThrow()
  })
})
