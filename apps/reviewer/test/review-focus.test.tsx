// @vitest-environment happy-dom
import { createElement, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReviewDiff } from '../src/features/review/useReviewDiff'
import { useReviewFocus } from '../src/features/review/useReviewFocus'
import { DiffSide, LineKind, Provider, type ReviewDraft } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'
import { fixtureBobFinding } from './fixtures/bob'
import { required } from './fixtures/bob'

const context = vi.hoisted(() => ({ contents: new Map(), load: vi.fn(() => Promise.resolve()) }))
vi.mock('../src/features/review/diff/useFileContext', () => ({ useFileContext: () => context }))
afterEach(cleanup)

function setup(side = DiffSide.right) {
  const pull = { ...fixturePull(), groupingSource: Provider.codex }
  const finding = fixtureBobFinding()
  const targetFile = required(pull.files.find((file) => file.path === finding.path))
  const line =
    side === DiffSide.left
      ? required(
          required(targetFile.hunks.find((hunk) => hunk.id === finding.hunkId)).lines.find(
            (line) => line.kind === LineKind.removed,
          ),
        ).oldLine
      : finding.line
  const targetGroup = required(pull.groups.find((group) => group.hunkIds.includes(finding.hunkId)))
  const initialGroup = required(pull.groups.find((group) => group.id !== targetGroup.id))
  const viewer = { scrollTo: vi.fn(), setSelectedLines: vi.fn(), clearSelectedLines: vi.fn() }
  const viewerRef = { current: viewer }
  const hook = renderHook(
    () => {
      const [draft, setDraft] = useState<ReviewDraft>({
        comments: [],
        summary: '',
        viewedFileIds: [],
        viewedHunkIds: [finding.hunkId],
      })
      const diff = useReviewDiff(pull, draft, setDraft)
      const focus = useReviewFocus(pull, { ...diff, viewerRef })
      return { diff, focus, draft }
    },
    {
      wrapper: ({ children }) =>
        createElement(MemoryRouter, {
          initialEntries: [`/?group=${initialGroup.id}&unviewed=1&diff=split&filter=requested`],
          children,
        }),
    },
  )
  return {
    ...hook,
    viewer,
    targetFile,
    targetGroup,
    location: { ...finding, side, line: required(line) },
  }
}

describe('review companion navigation in the existing diff', () => {
  it.each([DiffSide.right, DiffSide.left])(
    'reveals filtered and viewed code, expands it and centers the %s line',
    (side) => {
      const hook = setup(side)
      act(() => {
        hook.result.current.focus.focusLine(hook.location)
      })

      expect(hook.result.current.diff.selected?.id).toBe(hook.targetGroup.id)
      expect(hook.result.current.diff.unviewedOnly).toBe(false)
      expect(hook.result.current.diff.split).toBe(true)
      expect(hook.result.current.diff.searchParams.get('filter')).toBe('requested')
      expect(
        hook.result.current.diff.items.find((item) => item.id === hook.targetFile.id)?.collapsed,
      ).toBe(false)
      expect(hook.viewer.scrollTo).toHaveBeenLastCalledWith({
        type: 'line',
        id: hook.targetFile.id,
        lineNumber: hook.location.line,
        side: side === DiffSide.left ? 'deletions' : 'additions',
        align: 'center',
      })
      expect(hook.viewer.setSelectedLines).toHaveBeenLastCalledWith({
        id: hook.targetFile.id,
        range: {
          start: hook.location.line,
          end: hook.location.line,
          side: side === DiffSide.left ? 'deletions' : 'additions',
        },
      })
      expect(hook.result.current.draft.viewedHunkIds).toContain(hook.location.hunkId)
    },
  )
  it('clears the highlight when the companion closes, without changing draft feedback', () => {
    const hook = setup()
    act(() => {
      hook.result.current.focus.focusLine(hook.location)
    })
    const calls = hook.viewer.clearSelectedLines.mock.calls.length
    act(() => {
      hook.result.current.focus.focusLine(undefined)
    })

    expect(hook.result.current.focus.active).toBe(false)
    expect(hook.viewer.clearSelectedLines.mock.calls.length).toBeGreaterThan(calls)
    expect(hook.result.current.draft.comments).toEqual([])
    expect(hook.result.current.draft.viewedHunkIds).toContain(hook.location.hunkId)
  })
})
