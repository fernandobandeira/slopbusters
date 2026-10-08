// @vitest-environment happy-dom
import { required } from './fixtures/bob'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReviewDiff } from '../src/features/review/useReviewDiff'
import { GroupSidebar } from '../src/features/review/GroupSidebar'
import { ReviewSectionList } from '../src/features/review/ReviewSectionList'
import { ReviewChangesSummary } from '../src/features/review/ReviewChangesSummary'
import { nextUpdatedLocation } from '../src/features/review/reviewUpdates'
import { sectionPull } from './fixtures/sections'
import { Provider, DiffSide, type ReviewDraft } from '../shared/domain/types'
import { compareReviewSections } from '../server/features/sectionComparison'
import { emptyDraft } from '../server/features/progress'

vi.mock('../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => ({ contents: new Map(), load: () => Promise.resolve() }),
}))
afterEach(cleanup)
const base = 'function first() {\n  return 1\n}\n\nfunction second() {\n  return 2\n}\n'
const before = sectionPull(base, base.replace('return 1', 'return 10'))
const pull = {
  ...sectionPull(base, base.replace('return 1', 'return 10').replace('return 2', 'return 20')),
  groupingSource: Provider.codex,
}
const changes = compareReviewSections(before, pull)

function Harness() {
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft())
  const diff = useReviewDiff(pull, draft, setDraft, changes)
  return (
    <>
      <GroupSidebar
        pull={pull}
        draft={draft}
        changes={changes}
        selectedId={diff.selected?.id}
        inboxUrl="/"
        submitting={false}
        organizing={false}
        onSelect={() => {}}
        onRegenerate={() => {}}
        onNotice={() => {}}
      />
      <ReviewSectionList
        pull={pull}
        group={diff.visibleGroup}
        draft={draft}
        changes={changes}
        onView={diff.toggleSections}
        onFocus={() => {}}
      />
      <button
        onClick={() => {
          diff.toggleFile(required(pull.files[0]).id)
        }}
      >
        Mark displayed file viewed
      </button>
      <output>{JSON.stringify(draft.viewedHunkIds)}</output>
    </>
  )
}

describe('visible review updates', () => {
  it('marks only displayed sections when filtering changes since review', () => {
    render(
      <MemoryRouter initialEntries={['/?changes=1']}>
        <Harness />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Not yet viewed')).toBeNull()
    expect(screen.getByText('New since review')).toBeTruthy()
    expect(screen.getByText('0/2 sections viewed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark displayed file viewed' }))
    expect(screen.getByText('1/2 sections viewed')).toBeTruthy()
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    expect(screen.getByRole('status').textContent).toBe(
      JSON.stringify([required(required(pull.files[0]).hunks[1]).id]),
    )
  })

  it('shows partial progress without marking the whole group viewed', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    )
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(required(checkboxes[0]))
    expect(screen.getByText('1/2 sections viewed')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Shared changes/ }).hasAttribute('data-reviewed'),
    ).toBe(false)
    expect(screen.getByText('Already viewed')).toBeTruthy()
    expect(checkboxes[1]).toHaveProperty('checked', false)
  })

  it('exposes removed code and separate counts for edited and context-changed sections', () => {
    render(
      <ReviewChangesSummary
        changes={{
          ...changes,
          sections: [
            { hunkId: 'one', state: 'changed' },
            { hunkId: 'two', state: 'context-changed' },
          ],
          removed: [{ path: 'gone.ts', line: 12, code: '-old\n+reviewed' }],
        }}
        changesOnly={false}
        onToggle={() => {}}
        onNext={() => {}}
      />,
    )
    expect(
      screen.getByText('0 new · 1 changed · 1 context changed · 1 removed sections'),
    ).toBeTruthy()
    expect(screen.getByText('gone.ts:12')).toBeTruthy()
    expect(screen.getByText('-old +reviewed')).toBeTruthy()
  })

  it('cycles through updated sections without marking them viewed', () => {
    const allUpdates = {
      ...changes,
      sections: required(pull.files[0]).hunks.map((hunk) => ({
        hunkId: hunk.id,
        state: 'changed' as const,
      })),
    }
    const first = nextUpdatedLocation(pull, allUpdates, emptyDraft())
    const second = nextUpdatedLocation(pull, allUpdates, emptyDraft(), { location: first })
    expect(first).toEqual({ path: 'shared.ts', line: 2, side: DiffSide.left })
    expect(second).toEqual({ path: 'shared.ts', line: 6, side: DiffSide.left })
    expect(nextUpdatedLocation(pull, allUpdates, emptyDraft(), { location: second })).toEqual(first)
  })
})
