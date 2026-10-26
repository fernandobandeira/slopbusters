import { describe, expect, it } from 'vitest'
import { required } from './fixtures/bob'
import { sectionPull } from './fixtures/sections'
import { diffItems } from '../src/lib/diffItems'
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
})
