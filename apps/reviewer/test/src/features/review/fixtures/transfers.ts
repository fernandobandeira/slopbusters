import { parseFile } from '../../../../../server/features/diff'
import {
  LineKind,
  TransferKind,
  type ChangedFile,
  type CodeTransfer,
  type PullRequest,
} from '../../../../../shared/domain/types'
import { fixturePull } from '../../../../fixtures/pull'

const block = ['  const a = 1', '  const b = 2', '  const c = 3', '  return a + b + c']

/** A pull that moves four lines from old.ts (10–13) to new.ts (21–24), editing the third. */
export function transferPull(overrides: Partial<CodeTransfer> = {}): PullRequest {
  const source = parseFile({
    path: 'src/old.ts',
    status: 'modified',
    additions: 0,
    deletions: 4,
    patch: ['@@ -10,4 +9,0 @@', ...block.map((line) => `-${line}`)].join('\n'),
  })
  const destination = parseFile({
    path: 'src/new.ts',
    status: 'modified',
    additions: 4,
    deletions: 0,
    patch: [
      '@@ -20,0 +21,4 @@',
      ...block.map((line, index) => (index === 2 ? '+  const c = 4' : `+${line}`)),
    ].join('\n'),
  })
  const ids = (file: ChangedFile) => file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id))
  const transfer: CodeTransfer = {
    id: 'moved-block',
    kind: TransferKind.moved,
    fromPath: 'src/old.ts',
    fromLine: 10,
    fromEndLine: 13,
    toPath: 'src/new.ts',
    toLine: 21,
    toEndLine: 24,
    lineCount: 4,
    changedLines: 1,
    exact: false,
    changes: [
      {
        header: '@@ -11,3 +22,3 @@',
        lines: [
          { kind: LineKind.context, text: '  const b = 2', oldLine: 11, newLine: 22 },
          { kind: LineKind.removed, text: '  const c = 3', oldLine: 12, newLine: null },
          { kind: LineKind.added, text: '  const c = 4', oldLine: null, newLine: 23 },
          { kind: LineKind.context, text: '  return a + b + c', oldLine: 13, newLine: 24 },
        ],
      },
    ],
    sourceLineIds: ids(source),
    destinationLineIds: ids(destination),
    text: block.join('\n'),
    ...overrides,
  }
  const base = fixturePull()
  const group = base.groups[0]
  if (!group) throw new Error('Fixture needs a group')
  return {
    ...base,
    files: [source, destination],
    transfers: [transfer],
    groups: [
      {
        ...group,
        id: 'both',
        fileIds: [source.id, destination.id],
        hunkIds: [...source.hunks, ...destination.hunks].map((hunk) => hunk.id),
      },
      {
        ...group,
        id: 'destination',
        fileIds: [destination.id],
        hunkIds: destination.hunks.map((hunk) => hunk.id),
      },
    ],
  }
}
