// @vitest-environment happy-dom
import type { CodeViewHandle } from '@pierre/diffs/react'
import { useImperativeHandle, useState, type ComponentProps } from 'react'
import { MemoryRouter } from 'react-router'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  DiffSide,
  LineKind,
  type PullDiscussions,
  type PullRequest,
  type ReviewDraft,
  type ReviewThread,
} from '../../../../shared/domain/types'
import { ReviewWorkspace } from '../../../../src/features/review/ReviewWorkspace'
import type { ReviewDiffCodeView } from '../../../../src/components/ReviewDiffCodeView'
import type { LineNote } from '../../../../src/features/review/transferNotes'
import { questionPull, supportingLine } from '../../../fixtures/questionPull'
import { required } from '../../../fixtures/required'

const context = vi.hoisted(() => ({
  contents: new Map(),
  isLoading: () => false,
  error: () => undefined,
  load: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../../../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => context,
}))
vi.mock('../../../../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'github-dark', resolvedTheme: 'dark' }),
}))
const viewer = vi.hoisted(() => ({
  scrollTo: vi.fn(),
  setSelectedLines: vi.fn(),
  clearSelectedLines: vi.fn(),
}))
vi.mock('../../../../src/components/ReviewDiffCodeView', () => ({
  ReviewDiffCodeView: (props: ComponentProps<typeof ReviewDiffCodeView<LineNote>>) => {
    useImperativeHandle(
      props.viewerRef,
      () => viewer as unknown as CodeViewHandle<LineNote, undefined>,
      [],
    )
    return (
      <>
        {props.items?.map((item) => (
          <div key={item.id}>
            {props.renderHeaderMetadata?.(item)}
            {item.type === 'diff' && item.fileDiff.name}
          </div>
        ))}
        {props.renderCodeViewFooter?.()}
      </>
    )
  },
}))

let draft: ReviewDraft
let discussions: PullDiscussions
vi.mock('../../../../src/features/review/useReviewDraft', () => ({
  useReviewDraft: () => {
    const [value, setDraft] = useState(draft)
    return { draft: value, setDraft, ready: true }
  },
}))
vi.mock('../../../../src/features/review/discussions/useDiscussions', () => ({
  useDiscussions: () => ({ discussions, postReply: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  const { headSha, baseSha } = questionPull()
  draft = { comments: [], summary: '', viewedFileIds: [], viewedHunkIds: [] }
  discussions = { headSha, baseSha, threads: [] }
})
afterEach(cleanup)

function workspace(pull: PullRequest) {
  return (
    <MemoryRouter>
      <ReviewWorkspace
        pull={pull}
        onUpdate={vi.fn()}
        onReload={vi.fn()}
        reloading={false}
        inboxUrl="/"
      />
    </MemoryRouter>
  )
}

function threadAt(path: string, line: number | null): ReviewThread {
  return {
    id: 'thread',
    path,
    line,
    side: DiffSide.right,
    originalLine: line,
    outdated: false,
    resolved: false,
    canReply: false,
    comments: [],
  }
}

function openThread(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /Discussions \d/ }))
  fireEvent.click(
    within(screen.getByRole('complementary', { name: 'Discussions' })).getByRole('button', {
      name,
    }),
  )
}

it('jumps from the tray to a supporting line once without leaving a selection', () => {
  const pull = questionPull()
  const { path, line } = supportingLine(pull)
  discussions.threads = [threadAt(path, line)]
  const { container } = render(workspace(pull))

  openThread(`${path}:${line}`)
  expect(screen.getByRole('button', { name: /Hide 2 supporting sections/ })).toBeTruthy()
  expect(viewer.scrollTo).toHaveBeenCalledExactlyOnceWith({
    type: 'line',
    id: required(pull.files.find((file) => file.path === path)).id,
    lineNumber: line,
    side: 'additions',
    align: 'center',
  })

  fireEvent.click(screen.getByRole('button', { name: /Show 3 test sections/ }))
  expect(viewer.scrollTo).toHaveBeenCalledTimes(1)
  expect(viewer.setSelectedLines).not.toHaveBeenCalled()
  expect(container.querySelector('.review-focusing-line')).toBeNull()
})

it('reveals a test-only file for discussions without a matching line', () => {
  const pull = questionPull()
  const path = 'test/projects.test.ts'
  discussions.threads = [
    { ...threadAt(path, null), id: 'outdated', outdated: true },
    threadAt(path, 999),
  ]
  render(workspace(pull))

  expect(screen.queryByText(path, { exact: true })).toBeNull()
  openThread(`${path}:file`)
  expect(screen.getByText(path, { exact: true })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Other discussions on these files' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Hide 3 test sections/ }))
  fireEvent.click(
    within(screen.getByRole('complementary', { name: 'Discussions' })).getByRole('button', {
      name: `${path}:999`,
    }),
  )
  expect(screen.getByText(path, { exact: true })).toBeTruthy()
})

it('counts hidden drafts and GitHub threads on their section controls without listing them in the footer', () => {
  const pull = questionPull()
  const { path, line } = supportingLine(pull)
  discussions.threads = [threadAt(path, line)]
  const testFile = required(pull.files.find((file) => file.path === 'test/projects.test.ts'))
  const testLine = required(
    testFile.hunks.flatMap((hunk) => hunk.lines).find((line) => line.kind === LineKind.added)
      ?.newLine,
  )
  draft.comments = [
    {
      id: 'draft',
      body: 'Check this case.',
      headSha: pull.headSha,
      path: testFile.path,
      line: testLine,
      side: DiffSide.right,
    },
  ]
  render(workspace(pull))

  const support = screen.getByRole('button', { name: /Show 2 supporting sections.*1 discussion/ })
  expect(screen.getByRole('button', { name: /Show 3 test sections.*1 discussion/ })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Other discussions on these files' })).toBeNull()
  fireEvent.click(support)
  expect(screen.getByRole('button', { name: 'Hide 2 supporting sections 9 lines' })).toBeTruthy()
})

it('shows the reason above the diff when a set-aside group is opened', () => {
  const pull = questionPull()
  const group = required(pull.groups.find((group) => group.lane === 'mechanical'))
  render(workspace(pull))

  fireEvent.click(screen.getByRole('button', { name: /Extract the shared slug helper/ }))
  expect(
    within(screen.getByRole('region', { name: 'Code changes' })).getByText(group.reason),
  ).toBeTruthy()
})

it('starts regenerated groups with optional sections closed even when an id is reused', () => {
  const pull = questionPull()
  const { rerender } = render(workspace(pull))
  fireEvent.click(screen.getByRole('button', { name: /Show 2 supporting sections/ }))

  const [group, ...rest] = pull.groups
  rerender(
    workspace({
      ...pull,
      groups: [{ ...required(group), question: 'Which callers can update a project?' }, ...rest],
    }),
  )

  expect(screen.getByRole('heading', { name: 'Which callers can update a project?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Show 2 supporting sections/ })).toBeTruthy()
})
