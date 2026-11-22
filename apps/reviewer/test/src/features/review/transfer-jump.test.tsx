// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { useTransferJump } from '../../../../src/features/review/useTransferJump'
import { useReviewDiff } from '../../../../src/features/review/useReviewDiff'
import { questionPull } from '../../../fixtures/questionPull'
import { required } from '../../../fixtures/required'
import {
  DiffSide,
  LineKind,
  type ChangeGroup,
  type ReviewDraft,
} from '../../../../shared/domain/types'
import { diffItems } from '../../../../src/lib/diffItems'
import type { CodeViewItem } from '@pierre/diffs'
import { transferPull } from './fixtures/transfers'

const pull = transferPull()
const [both, destination] = pull.groups as [ChangeGroup, ChangeGroup]
const [source] = pull.files

it('opens the group holding the other end, then scrolls to it once its file is shown', () => {
  const scrollTo = vi.fn()
  const changeView = vi.fn()
  const revealFile = vi.fn()
  const viewerRef = { current: { scrollTo } }
  const { result, rerender } = renderHook(
    ({ selected, items }: { selected: ChangeGroup; items: CodeViewItem<undefined>[] }) =>
      useTransferJump({ selected, items, changeView, revealFile, viewerRef }),
    { initialProps: { selected: destination, items: diffItems(pull, destination) } },
  )

  act(() => {
    result.current({ fileId: source?.id ?? '', side: DiffSide.left, line: 13, groupId: both.id })
  })
  expect(changeView).toHaveBeenCalledWith({ groupId: both.id })
  expect(revealFile).toHaveBeenCalledWith(source?.id, both.id, {
    fileId: source?.id ?? '',
    side: DiffSide.left,
    line: 13,
    groupId: both.id,
  })
  expect(scrollTo).not.toHaveBeenCalled()

  rerender({ selected: both, items: diffItems(pull, both) })
  expect(scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ id: source?.id, lineNumber: 13, side: 'deletions' }),
  )
})

const context = vi.hoisted(() => ({ contents: new Map(), load: vi.fn(() => Promise.resolve()) }))
vi.mock('../../../../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => context,
}))

it('scrolls on each jump to an already open key section in a question group', () => {
  const pull = questionPull()
  const group = required(pull.groups[0])
  const file = required(pull.files.find((file) => file.path === 'src/access/permissions.ts'))
  const hunk = required(file.hunks.find((hunk) => group.hunkIds.includes(hunk.id)))
  const line = required(hunk.lines.find((line) => line.kind === LineKind.added)?.newLine)
  const scrollTo = vi.fn()
  const { result } = renderHook(
    () => {
      const [draft, setDraft] = useState<ReviewDraft>({
        comments: [],
        summary: '',
        viewedFileIds: [],
      })
      const diff = useReviewDiff(pull, draft, setDraft)
      const viewerRef = useRef({ scrollTo })
      return useTransferJump({ ...diff, viewerRef })
    },
    { wrapper: MemoryRouter },
  )
  const target = { fileId: file.id, side: DiffSide.right, line }

  act(() => {
    result.current(target)
  })
  expect(scrollTo).toHaveBeenCalledTimes(1)
  act(() => {
    result.current(target)
  })
  expect(scrollTo).toHaveBeenCalledTimes(2)
  expect(scrollTo).toHaveBeenLastCalledWith({
    type: 'line',
    id: file.id,
    side: 'additions',
    lineNumber: line,
    align: 'center',
  })
})
