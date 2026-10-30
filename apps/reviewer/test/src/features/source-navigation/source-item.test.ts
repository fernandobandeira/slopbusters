import { describe, expect, it } from 'vitest'
import { parseDiffFromFile } from '@pierre/diffs'
import { additionLine, sourceItem } from '../../../../src/features/source-navigation/sourceItem'
import type { PullFileContent } from '../../../../shared/domain/fileContent'

const revision = (sha: string, content: string) => ({ path: 'src/a.ts', sha, content, symbols: [] })
const content: PullFileContent = {
  fileId: 'a',
  old: revision('base', 'const a = 1\n'),
  new: revision('head', 'const a = 2\n'),
}

describe('source opened from a review', () => {
  it('shows a PR file as its diff when the opened revision is the one the PR compares', () => {
    const item = sourceItem(revision('head', 'const a = 2\n'), 'new', content)
    if (item.type !== 'diff') throw new Error('Expected a diff')
    expect(item.fileDiff.deletionLines).toEqual(['const a = 1\n'])
    expect(item.fileDiff.additionLines).toEqual(['const a = 2\n'])
  })

  it('shows plain source for other files and for revisions with other edits', () => {
    expect(sourceItem(revision('head', 'const a = 2\n'), 'new').type).toBe('file')
    expect(sourceItem(revision('local', 'const a = 3\n'), 'new', content).type).toBe('file')
  })

  it('maps an old line to the new line beside it so a collapsed target can be revealed', () => {
    const old = Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`)
    const next = [...old.slice(0, 9), 'added a', 'added b', ...old.slice(9)]
    const diff = parseDiffFromFile(
      { name: 'a.ts', contents: `${old.join('\n')}\n` },
      { name: 'a.ts', contents: `${next.join('\n')}\n` },
    )
    expect(additionLine(diff, 5)).toBe(5)
    expect(additionLine(diff, 25)).toBe(27)
  })
})
