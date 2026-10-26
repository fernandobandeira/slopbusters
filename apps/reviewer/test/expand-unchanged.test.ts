import { describe, expect, it } from 'vitest'
import { required } from './fixtures/bob'
import { sectionPull } from './fixtures/sections'
import { diffItems } from '../src/lib/diffItems'
import { reviewItems } from '../src/features/review/reviewUpdates'
import { enclosingSymbol } from '../src/features/review/diff/separatorSymbols'
import type { PullFileContent } from '../shared/domain/fileContent'
import type { PullRequest } from '../shared/domain/types'

const lines = Array.from({ length: 40 }, (_, index) => `const line${index + 1} = ${index + 1}`)
const before = `${lines.join('\n')}\n`
const after = before.replace('line5 = 5', 'line5 = 50').replace('line35 = 35', 'line35 = 350')

function contents(pull: PullRequest, old: string, next: string) {
  const file = required(pull.files[0])
  const revision = (sha: string, content: string) => ({
    path: file.path,
    sha,
    content,
    symbols: [],
  })
  return new Map<string, PullFileContent>([
    [file.id, { fileId: file.id, old: revision('base', old), new: revision('head', next) }],
  ])
}

function fileDiff(pull: PullRequest, hunkIds: string[], loaded?: Map<string, PullFileContent>) {
  const group = { ...required(pull.groups[0]), hunkIds }
  const item = required(diffItems(pull, group, loaded)[0])
  if (item.type !== 'diff') throw new Error('Expected a diff')
  return item.fileDiff
}

describe('expanding unchanged lines in place', () => {
  it('gives the viewer full revisions when every collapsed gap is unchanged', () => {
    const pull = sectionPull(before, after)
    const all = required(pull.files[0]).hunks.map((hunk) => hunk.id)
    const diff = fileDiff(pull, all, contents(pull, before, after))
    expect(diff.isPartial).toBe(false)
    expect(diff.additionLines).toHaveLength(40)
    expect(diff.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([1, 23])
  })

  it('keeps a partial diff when a gap hides another group’s edit', () => {
    const pull = sectionPull(before, after)
    const first = required(required(pull.files[0]).hunks[0]).id
    expect(fileDiff(pull, [first], contents(pull, before, after)).isPartial).toBe(true)
  })

  it('keeps a partial diff when the loaded revisions disagree with the patch', () => {
    const pull = sectionPull(before, after)
    const all = required(pull.files[0]).hunks.map((hunk) => hunk.id)
    const stale = after.replace('line6 = 6', 'line6 = 60')
    expect(fileDiff(pull, all, contents(pull, before, stale)).isPartial).toBe(true)
  })

  it('reveals other groups’ edits so every gap expands, without counting them as this group’s', () => {
    const pull = sectionPull(before, after)
    const file = required(pull.files[0])
    const first = required(file.hunks[0]).id
    const group = { ...required(pull.groups[0]), hunkIds: [first] }
    const display = reviewItems({
      pull,
      displayPull: pull,
      group,
      contents: contents(pull, before, after),
      full: false,
      revealed: () => true,
    })
    const item = required(display.items[0])
    if (item.type !== 'diff') throw new Error('Expected a diff')
    expect(item.fileDiff.isPartial).toBe(false)
    expect(item.fileDiff.hunks).toHaveLength(2)
    expect(display.sections.get(item.id)).toEqual([first])
  })
})

describe('enclosing symbol labels', () => {
  const symbols = [
    { name: 'BalanceCardService', kind: 'class' as const, line: 10, endLine: 400 },
    { name: 'BalanceCardService.topUp', kind: 'method' as const, line: 300, endLine: 350 },
    { name: 'helper', kind: 'function' as const, line: 500, endLine: 510 },
  ]

  it('names the innermost symbol without repeating a qualified parent', () => {
    expect(enclosingSymbol(symbols, 329)).toBe('BalanceCardService.topUp')
    expect(enclosingSymbol(symbols, 20)).toBe('BalanceCardService')
    expect(enclosingSymbol(symbols, 505)).toBe('helper')
    expect(enclosingSymbol(symbols, 450)).toBeUndefined()
  })
})
