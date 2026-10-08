import { createTwoFilesPatch } from 'diff'
import { parseFile } from '../../server/features/diff'
import { Priority, type PullRequest } from '../../shared/domain/types'
import { fixturePull } from './pull'

export function sectionPull(before: string, after: string): PullRequest {
  const raw = createTwoFilesPatch('shared.ts', 'shared.ts', before, after)
  const patch = raw.slice(raw.indexOf('@@'))
  const file = parseFile({
    path: 'shared.ts',
    status: 'modified',
    patch,
    additions: patch.split('\n').filter((line) => line.startsWith('+')).length,
    deletions: patch.split('\n').filter((line) => line.startsWith('-')).length,
  })
  return {
    ...fixturePull(),
    files: [file],
    groups: [
      {
        id: 'one',
        title: 'Shared changes',
        priority: Priority.normal,
        reason: '',
        fileIds: [file.id],
        hunkIds: file.hunks.map((hunk) => hunk.id),
      },
    ],
    transfers: [],
  }
}
