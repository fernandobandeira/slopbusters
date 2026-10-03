import { describe, expect, it } from 'vitest'
import { createTwoFilesPatch } from 'diff'
import { parseFile } from '../shared/diff'
import type { PullFileContent } from '../shared/fileContent'
import { LineKind } from '../shared/types'
import { expandDisplayHunk, MAX_CONTEXT } from '../src/displayContext'

function fixture() {
  const old = Array.from({ length: 1000 }, (_, i) => `original ${i + 1}`)
  const next = [...old]
  next[199] = 'changed first'
  next[239] = 'changed other group'
  const before = `${old.join('\n')}\n`
  const after = `${next.join('\n')}\n`
  const patch = createTwoFilesPatch('sample.ts', 'sample.ts', before, after)
    .split('\n')
    .slice(4)
    .join('\n')
  const file = parseFile({
    path: 'sample.ts',
    status: 'modified',
    additions: 2,
    deletions: 2,
    patch,
    oldContent: before,
  })
  const content: PullFileContent = {
    fileId: file.id,
    old: { path: file.path, sha: 'old', content: before, symbols: [] },
    new: { path: file.path, sha: 'new', content: after, symbols: [] },
  }
  return { file, content }
}

describe('bounded unchanged context', () => {
  it('preserves canonical hunks, ids and changed line coordinates while expanding the display', () => {
    const { file, content } = fixture()
    const original = JSON.stringify(file)
    const expanded = expandDisplayHunk(file, file.hunks[0]!, content, 20)
    expect(expanded.id).toBe(file.hunks[0]!.id)
    expect(expanded.lines.length).toBeGreaterThan(file.hunks[0]!.lines.length)
    expect(expanded.lines.filter((line) => line.kind !== LineKind.context)).toEqual(
      file.hunks[0]!.lines.filter((line) => line.kind !== LineKind.context),
    )
    expect(JSON.stringify(file)).toBe(original)
  })
  it('never crosses an omitted changed hunk or duplicates a gap when both sections expand', () => {
    const { file, content } = fixture()
    const first = expandDisplayHunk(file, file.hunks[0]!, content, 1000)
    const second = expandDisplayHunk(file, file.hunks[1]!, content, 1000)
    expect(first.lines.some((line) => line.text === 'changed other group')).toBe(false)
    const firstLines = new Set(first.lines.map((line) => line.newLine).filter(Boolean))
    expect(second.lines.some((line) => line.newLine && firstLines.has(line.newLine))).toBe(false)
    expect(second.lines.length).toBeLessThanOrEqual(file.hunks[1]!.lines.length + MAX_CONTEXT * 2)
  })
  it('stops at mismatching exact content and does not expand incomplete patches', () => {
    const { file, content } = fixture()
    expect(expandDisplayHunk({ ...file, coverage: 'partial' }, file.hunks[0]!, content, 20)).toBe(
      file.hunks[0],
    )
    const current = file.hunks[0]!
    const before = current.lines.find((line) => line.newLine !== null)!.newLine! - 1
    const altered = content.new!.content.split('\n')
    altered[before - 1] = 'unexpected mismatch'
    const expanded = expandDisplayHunk(
      file,
      current,
      { ...content, new: { ...content.new!, content: altered.join('\n') } },
      20,
    )
    expect(expanded.lines[0]).toEqual(current.lines[0])
  })
})
