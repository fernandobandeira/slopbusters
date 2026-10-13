// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CodeTransfers } from '../src/features/review/CodeTransfers'
import { TransferKind, type CodeTransfer } from '../shared/domain/types'

afterEach(cleanup)

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
    />,
  )

  const summary = screen.getByText('2 copied and 1 moved sections')
  const panel = summary.closest('details')
  expect(panel?.open).toBe(false)
  expect(screen.getByText('10 unchanged lines')).toBeTruthy()
  expect(screen.getAllByText('src/old.ts:10')).toHaveLength(3)
})

it('renders nothing when the group moved or copied no code', () => {
  const { container } = render(<CodeTransfers transfers={[]} />)

  expect(container.innerHTML).toBe('')
})
