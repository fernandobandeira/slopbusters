// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CodeTransfers } from '../src/features/review/CodeTransfers'
import { TransferKind, type ChangedFile, type CodeTransfer } from '../shared/domain/types'
import type { PullFileContent } from '../shared/domain/fileContent'
import { fixturePull } from './fixtures/pull'

afterEach(cleanup)

function file(id: string, path: string): ChangedFile {
  return {
    id,
    path,
    status: 'modified',
    additions: 0,
    deletions: 0,
    hunks: [],
    coverage: 'complete',
  }
}
const pull = { ...fixturePull(), files: [file('old', 'src/old.ts'), file('new', 'src/new.ts')] }
const load = () => Promise.reject(new Error('not loaded'))
const block = Array.from({ length: 4 }, (_, index) => `  step${String(index)}()`)
function revision(path: string, content: string, symbol: string, line: number) {
  return {
    path,
    sha: path,
    content,
    symbols: [{ name: symbol, kind: 'function' as const, line, endLine: line + 10 }],
  }
}

function transfer(id: string, kind: TransferKind, lineCount: number): CodeTransfer {
  return {
    id,
    kind,
    fromPath: 'src/old.ts',
    fromLine: 10,
    toPath: 'src/new.ts',
    toLine: 20,
    lineCount,
    destinationLineIds: [],
    sourceLineIds: [],
    text: 'export const value = 1',
  }
}

it('keeps moved and copied code behind one collapsed summary', () => {
  render(
    <CodeTransfers
      transfers={[
        transfer('a', TransferKind.copied, 5),
        transfer('b', TransferKind.copied, 4),
        transfer('c', TransferKind.moved, 1),
      ]}
      pull={pull}
      contents={new Map()}
      load={load}
    />,
  )

  const summary = screen.getByText('2 copied and 1 moved sections')
  const panel = summary.closest('details')
  expect(panel?.open).toBe(false)
  expect(screen.getByText('10 unchanged lines')).toBeTruthy()
  expect(screen.getAllByText('src/old.ts:10')).toHaveLength(3)
})

it('renders nothing when the group moved or copied no code', () => {
  const { container } = render(
    <CodeTransfers transfers={[]} pull={pull} contents={new Map()} load={load} />,
  )

  expect(container.innerHTML).toBe('')
})

it('flags and opens a block that moved into a different function, with the code around it', () => {
  const old = [
    '',
    ...Array.from({ length: 8 }, () => ''),
    'function withdraw() {',
    ...block,
    '}',
  ].join('\n')
  const next = [...Array.from({ length: 19 }, () => ''), 'function topUp() {', ...block, '}'].join(
    '\n',
  )
  const contents = new Map<string, PullFileContent>([
    ['old', { fileId: 'old', old: revision('src/old.ts', old, 'withdraw', 10), new: null }],
    ['new', { fileId: 'new', old: null, new: revision('src/new.ts', next, 'topUp', 20) }],
  ])
  render(
    <CodeTransfers
      transfers={[{ ...transfer('a', TransferKind.moved, 4), fromLine: 11, toLine: 21 }]}
      pull={pull}
      contents={contents}
      load={load}
    />,
  )

  expect(screen.getByText('1 changed function').closest('details')?.open).toBe(true)
  expect(screen.getByText('changed function').closest('details')?.open).toBe(true)
  expect(screen.getByText(/in withdraw/)).toBeTruthy()
  expect(screen.getByText(/in topUp/)).toBeTruthy()
  expect(screen.getAllByText('function topUp() {')).toHaveLength(1)
})
