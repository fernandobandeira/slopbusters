import { describe, expect, it } from 'vitest'
import {
  emptySourceHistory,
  isCurrentDefinition,
  navigationOutcome,
  visitSource,
} from '../src/features/source-navigation/sourceNavigationHistory'

const visit = (path: string) => ({
  file: { path, sha: 'saved', content: '', symbols: [] },
  target: { path, line: 4, column: 8, endLine: 4, endColumn: 14, name: 'chosen' },
})

describe('source navigation outcomes and history', () => {
  it('retains the origin, supports back/forward, and replaces the forward branch after a new jump', () => {
    const first = visitSource(emptySourceHistory, visit('first.ts'))
    const second = visitSource(first, visit('second.ts'))
    expect(second.index).toBe(1)
    const back = { ...second, index: 0 }
    expect(back.visits[back.index]!.file.path).toBe('first.ts')
    const replaced = visitSource(back, visit('third.ts'))
    expect(replaced.visits.map((entry) => entry.file.path)).toEqual(['first.ts', 'third.ts'])
    expect({ ...first, index: -1 }.visits[-1]).toBeUndefined()
  })
  it('recognizes a caret already in the declaration and explains empty results', () => {
    const target = visit('first.ts').target
    expect(isCurrentDefinition('first.ts', { line: 4, column: 9, text: 'chosen' }, target)).toBe(
      true,
    )
    expect(isCurrentDefinition('first.ts', { line: 4, column: 14, text: 'other' }, target)).toBe(
      false,
    )
    expect(isCurrentDefinition('second.ts', { line: 4, column: 9, text: 'chosen' }, target)).toBe(
      false,
    )
    expect(navigationOutcome('definition', 0)).toContain('No definition found')
    expect(navigationOutcome('references', 0)).toContain('No references found')
    expect(navigationOutcome('definition', 1)).toBe('')
  })
})
