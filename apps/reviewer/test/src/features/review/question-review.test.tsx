// @vitest-environment happy-dom
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GroupSidebar } from '../../../../src/features/review/GroupSidebar'
import { ReviewQuestion } from '../../../../src/features/review/ReviewQuestion'
import { useReviewDiff } from '../../../../src/features/review/useReviewDiff'
import { useReviewFocus } from '../../../../src/features/review/useReviewFocus'
import { DiffSide, type ReviewDraft } from '../../../../shared/domain/types'
import { questionPull, supportingLine } from '../../../fixtures/questionPull'

const context = vi.hoisted(() => ({ contents: new Map(), load: vi.fn(() => Promise.resolve()) }))
vi.mock('../../../../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => context,
}))
afterEach(cleanup)

const pull = questionPull()
const viewer = { setSelectedLines: vi.fn(), clearSelectedLines: vi.fn(), scrollTo: vi.fn() }

function Harness() {
  const [draft, setDraft] = useState<ReviewDraft>({
    comments: [],
    summary: '',
    viewedFileIds: [],
    viewedHunkIds: [],
  })
  const diff = useReviewDiff(pull, draft, setDraft)
  const viewerRef = useRef(viewer)
  const focus = useReviewFocus(pull, { ...diff, viewerRef })
  return (
    <>
      <GroupSidebar
        pull={pull}
        draft={draft}
        selectedId={diff.selected?.id}
        inboxUrl="/"
        submitting={false}
        organizing={false}
        onSelect={(groupId) => {
          diff.changeView({ groupId })
        }}
        onRegenerate={() => {}}
        onNotice={() => {}}
      />
      {diff.question.sections && diff.selected && (
        <ReviewQuestion
          pull={pull}
          group={diff.selected}
          sections={diff.question.sections}
          open={diff.question.open}
          onToggle={diff.toggleQuestionSections}
        />
      )}
      <div aria-label="Displayed files">
        {diff.items.map(
          (item) =>
            item.type === 'diff' && (
              <button
                key={item.id}
                onClick={() => {
                  diff.toggleFile(item.id)
                }}
              >
                View {item.fileDiff.name}
              </button>
            ),
        )}
      </div>
      <output aria-label="Displayed sections">{diff.visibleGroup?.hunkIds.join(',')}</output>
      <output aria-label="Viewed sections">{draft.viewedHunkIds?.join(',')}</output>
      <output aria-label="Selected group">{diff.selected?.id}</output>
      <button
        onClick={() => {
          focus.focusLine({ ...supportingLine(pull), side: DiffSide.right })
        }}
      >
        Open cited line
      </button>
    </>
  )
}

function renderReview() {
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
}

it('lists questions, changed-line counts and set-aside lanes in review order', () => {
  renderReview()
  const sidebar = screen.getByRole('complementary', { name: 'Review navigation' })
  const rows = within(sidebar).getAllByRole('button').slice(1)
  expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(
    pull.groups.map((group) => group.title),
  )
  expect(within(rows[0]!).getByText('P1')).toBeTruthy()
  expect(within(rows[0]!).getByText('+7')).toBeTruthy()
  expect(within(rows[0]!).getByText('−1')).toBeTruthy()
  expect(within(rows[0]!).getByText('9 supporting')).toBeTruthy()
  expect(within(rows[0]!).getByText('13 test')).toBeTruthy()
  expect(within(rows[1]!).getByText('No test')).toBeTruthy()
  expect(within(sidebar).getByText('Read 9 of 49 lines')).toBeTruthy()
  expect(within(sidebar).getByRole('region', { name: 'Set aside' }).textContent).toContain(
    'mechanical',
  )
  const claim = screen.getByText(
    'Project updates require an editor or admin in the same organization.',
  )
  expect(claim.nextElementSibling?.textContent).toBe(
    'Can a viewer or an editor from another organization update a project?',
  )
})

it('opens each optional section independently and keeps it open when switching groups', () => {
  renderReview()
  const support = screen.getByRole('button', { name: 'Show 2 supporting sections 9 lines' })
  expect(support.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByLabelText('Displayed sections').textContent.split(',')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'View test/projects.test.ts' })).toBeNull()
  fireEvent.click(support)
  expect(screen.getByLabelText('Displayed sections').textContent.split(',')).toHaveLength(4)
  fireEvent.click(screen.getByRole('button', { name: /Record project updates/ }))
  fireEvent.click(screen.getByRole('button', { name: /Enforce project edit permissions/ }))
  expect(screen.getByRole('button', { name: /Hide 2 supporting sections/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show 3 test sections 13 lines' }))
  expect(screen.getByRole('button', { name: 'View test/projects.test.ts' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Hide 2 supporting sections/ }))
  expect(screen.getByLabelText('Displayed sections').textContent.split(',')).toHaveLength(5)
})

it('reveals the supporting section that owns a cited line', () => {
  renderReview()
  fireEvent.click(screen.getByRole('button', { name: /Record project updates/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Open cited line' }))
  expect(screen.getByLabelText('Selected group').textContent).toBe('permissions')
  expect(screen.getByRole('button', { name: /Hide 2 supporting sections/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Show 3 test sections/ })).toBeTruthy()
  expect(viewer.scrollTo).toHaveBeenLastCalledWith({
    type: 'line',
    id: pull.files.find((file) => file.path === supportingLine(pull).path)?.id,
    lineNumber: supportingLine(pull).line,
    side: 'additions',
    align: 'center',
  })
})

it('completes questions using only key sections and skips set-aside groups', () => {
  renderReview()
  fireEvent.click(screen.getByRole('button', { name: 'View src/access/permissions.ts' }))
  fireEvent.click(screen.getByRole('button', { name: 'View src/routes/projects.ts' }))
  expect(
    screen.getByRole('button', { name: /Enforce project edit permissions/ }).dataset.reviewed,
  ).toBe('true')
  expect(screen.getByLabelText('Viewed sections').textContent.split(',')).toHaveLength(2)
  expect(screen.getByLabelText('Selected group').textContent).toBe('audit')
  fireEvent.click(screen.getByRole('button', { name: 'View src/lib/audit.ts' }))
  expect(screen.getByLabelText('Selected group').textContent).toBe('audit')
  expect(screen.getByRole('button', { name: /Record project updates/ }).dataset.reviewed).toBe(
    'true',
  )
  fireEvent.click(screen.getByRole('button', { name: /Extract the shared slug helper/ }))
  expect(screen.getByRole('button', { name: 'View src/lib/slug.ts' })).toBeTruthy()
})
