// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTransferJump } from '../src/features/review/useTransferJump'
import { DiffSide, type ChangeGroup } from '../shared/domain/types'
import { transferPull } from './fixtures/transfers'

const pull = transferPull()
const [both, destination] = pull.groups as [ChangeGroup, ChangeGroup]
const [source] = pull.files

it('opens the group holding the other end, then scrolls to it once its file is shown', () => {
  const scrollTo = vi.fn()
  const changeView = vi.fn()
  const setFileCollapsed = vi.fn()
  const viewerRef = { current: { scrollTo } }
  const { result, rerender } = renderHook(
    ({ selected, items }: { selected: ChangeGroup; items: { id: string }[] }) =>
      useTransferJump({ selected, items, changeView, setFileCollapsed, viewerRef }),
    { initialProps: { selected: destination, items: [{ id: pull.files[1]?.id ?? '' }] } },
  )

  act(() => {
    result.current({ fileId: source?.id ?? '', side: DiffSide.left, line: 13, groupId: both.id })
  })
  expect(changeView).toHaveBeenCalledWith({ groupId: both.id })
  expect(setFileCollapsed).toHaveBeenCalledWith(source?.id, false, both.id)
  expect(scrollTo).not.toHaveBeenCalled()

  rerender({ selected: both, items: pull.files.map((file) => ({ id: file.id })) })
  expect(scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ id: source?.id, lineNumber: 13, side: 'deletions' }),
  )
})
