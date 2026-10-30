// @vitest-environment happy-dom
import type { CodeViewItem } from '@pierre/diffs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransferCard } from '../../../../src/features/review/TransferCard'
import type { TransferNote } from '../../../../src/features/review/transferNotes'
import { DiffSide, TransferKind, type PullRequest } from '../../../../shared/domain/types'
import type { PullFileContent } from '../../../../shared/domain/fileContent'
import { transferPull } from './fixtures/transfers'

// Pierre's viewer needs a real layout engine; the card only decides what it is given.
vi.mock('../../../../src/components/ReviewDiffCodeView', () => ({
  ReviewDiffCodeView: ({ items }: { items: CodeViewItem<undefined>[] }) => (
    <div data-testid="nested-diff">
      {items.flatMap((item) =>
        item.type === 'diff'
          ? [...item.fileDiff.deletionLines, ...item.fileDiff.additionLines]
          : [],
      )}
    </div>
  ),
}))
vi.mock('../../../../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'nord', resolvedTheme: 'dark' }),
}))
afterEach(cleanup)

const load = vi.fn(() => Promise.reject(new Error('not loaded')))

function revision(path: string, name: string, line: number) {
  return {
    path,
    sha: path,
    content: '',
    symbols: [{ name, kind: 'function' as const, line, endLine: line + 10 }],
  }
}
/** Old revision of old.ts and new revision of new.ts, each naming the function around the block. */
function symbols(pull: PullRequest, from: string, to: string) {
  const [source, destination] = pull.files
  if (!source || !destination) throw new Error('Fixture needs both files')
  return new Map<string, PullFileContent>([
    [source.id, { fileId: source.id, old: revision('src/old.ts', from, 9), new: null }],
    [destination.id, { fileId: destination.id, old: null, new: revision('src/new.ts', to, 20) }],
  ])
}

function renderCard(
  pull: PullRequest,
  note: Partial<TransferNote> = {},
  contents = new Map<string, PullFileContent>(),
) {
  const onJump = vi.fn()
  const transfer = pull.transfers[0]
  if (!transfer) throw new Error('Fixture needs a transfer')
  render(
    <TransferCard
      pull={pull}
      note={{ kind: 'transfer', transfer, end: 'destination', ...note }}
      contents={contents}
      load={load}
      onJump={onJump}
    />,
  )
  return { onJump }
}

describe('transfer card', () => {
  it('says where the block came from, how much changed, and jumps there', () => {
    const pull = transferPull()
    const counterpart = { fileId: 'old', side: DiffSide.left, line: 13, below: false }
    const { onJump } = renderCard(pull, { counterpart })

    expect(screen.getByText('Moved from')).toBeTruthy()
    expect(screen.getByText('src/old.ts:10–13')).toBeTruthy()
    expect(screen.getByText('1 of 4 lines changed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Jump ↑' }))
    expect(onJump).toHaveBeenCalledWith(counterpart)
  })

  it('points a copy source at its copy and hides changes and jump for an identical block', () => {
    const pull = transferPull({ kind: TransferKind.copied, exact: true, changedLines: 0 })

    renderCard(pull, { end: 'source' })

    expect(screen.getByText('Copied to')).toBeTruthy()
    expect(screen.getByText('src/new.ts:21–24')).toBeTruthy()
    expect(screen.getByText('identical')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /changes/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Jump/ })).toBeNull()
  })

  it('flags a block that moved into a different function', () => {
    const pull = transferPull()

    renderCard(pull, {}, symbols(pull, 'withdraw', 'topUp'))

    expect(screen.getByText('withdraw')).toBeTruthy()
    expect(screen.getByText('changed function')).toBeTruthy()
  })

  it('does not flag a block that stayed in a function of the same name', () => {
    const pull = transferPull()

    renderCard(pull, {}, symbols(pull, 'withdraw', 'withdraw'))

    expect(screen.queryByText('changed function')).toBeNull()
  })

  it('shows and hides the edits made inside the block', () => {
    renderCard(transferPull())

    fireEvent.click(screen.getByRole('button', { name: 'Show changes ▸' }))
    expect(
      screen.getByText(/What changed inside the moved block \(old 10–13 → new 21–24\)/),
    ).toBeTruthy()
    expect(screen.getByTestId('nested-diff').textContent).toContain('const c = 4')
    fireEvent.click(screen.getByRole('button', { name: 'Hide changes ▾' }))
    expect(screen.queryByTestId('nested-diff')).toBeNull()
  })

  it('opens another group for an end this view does not show', () => {
    const pull = transferPull()
    const counterpart = { fileId: 'old', side: DiffSide.left, line: 13, groupId: 'both' }
    const { onJump } = renderCard(pull, { counterpart })

    fireEvent.click(screen.getByRole('button', { name: 'Jump →' }))

    expect(onJump).toHaveBeenCalledWith(counterpart)
  })

  it('shows the original of a copy no section shows, one panel at a time', () => {
    const pull = transferPull({ kind: TransferKind.copied })
    const [source] = pull.files
    const original = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    const contents = new Map<string, PullFileContent>([
      [
        source?.id ?? '',
        {
          fileId: source?.id ?? '',
          old: { ...revision('src/old.ts', 'f', 1), content: [...original, ...block()].join('\n') },
          new: null,
        },
      ],
    ])
    renderCard(pull, {}, contents)

    fireEvent.click(screen.getByRole('button', { name: 'Show original ▸' }))
    const excerpt = screen.getByTestId('nested-diff').textContent
    expect(excerpt).toContain('seven')
    expect(excerpt).toContain('const a = 1')
    expect(excerpt).not.toContain('six')
    fireEvent.click(screen.getByRole('button', { name: 'Show changes ▸' }))
    expect(screen.queryByText(/The original in/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Show original ▸' })).toBeTruthy()
  })

  it('offers no original when the copy source is on screen', () => {
    const counterpart = { fileId: 'old', side: DiffSide.left, line: 13, below: false }

    renderCard(transferPull({ kind: TransferKind.copied }), { counterpart })

    expect(screen.queryByRole('button', { name: /original/ })).toBeNull()
  })
})

/** The four lines the fixture moves, at old.ts 10–13. */
function block() {
  return ['  const a = 1', '  const b = 2', '  const c = 3', '  return a + b + c']
}
