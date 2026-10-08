// @vitest-environment happy-dom
import { required } from './fixtures/bob'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReviewDiff } from '../src/features/review/useReviewDiff'
import { GroupSidebar } from '../src/features/review/GroupSidebar'
import { ReviewPullDetails } from '../src/features/review/CompactReviewHeader'
import {
  UPDATES_GROUP_ID,
  reviewItems,
  updatesGroup,
  type SectionTarget,
} from '../src/features/review/reviewUpdates'
import { useSectionCursor } from '../src/features/review/useSectionCursor'
import { annotateDiscussions } from '../src/features/review/discussions/discussions'
import { sectionPull } from './fixtures/sections'
import {
  Provider,
  DiffSide,
  LineKind,
  type PullRequest,
  type ReviewDraft,
} from '../shared/domain/types'
import type { ReviewChanges } from '../shared/domain/reviewChanges'
import { compareReviewSections } from '../server/features/sectionComparison'
import { emptyDraft } from '../server/features/progress'

vi.mock('../src/features/review/diff/useFileContext', () => ({
  useFileContext: () => ({ contents: new Map(), load: () => Promise.resolve() }),
}))
afterEach(cleanup)
const base = 'function first() {\n  return 1\n}\n\nfunction second() {\n  return 2\n}\n'
const first = base.replace('return 1', 'return 10')
const both = first.replace('return 2', 'return 20')
function grouped(pull: PullRequest): PullRequest {
  return { ...pull, groupingSource: Provider.codex }
}
// The reviewed revision edited both functions; the current one rewrites the second edit.
const pull = grouped(sectionPull(base, both.replace('return 20', 'return 30')))
const changes = compareReviewSections(sectionPull(base, both), pull)
const [firstHunk, secondHunk] = required(pull.files[0]).hunks
const fileId = required(pull.files[0]).id

function Harness({ initialChanges = changes }: { initialChanges?: ReviewChanges }) {
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft())
  const diff = useReviewDiff(pull, draft, setDraft, initialChanges)
  return (
    <>
      <GroupSidebar
        pull={pull}
        draft={draft}
        changes={initialChanges}
        updates={diff.updates}
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
      <p data-testid="selected">{diff.selected?.id}</p>
      <p data-testid="items">{diff.items.map((item) => item.id).join(',')}</p>
      <button
        onClick={() => {
          diff.markSectionViewed(required(secondHunk).id)
        }}
      >
        Mark updated section
      </button>
      <button
        onClick={() => {
          diff.toggleFile(required(diff.items[0]).id)
        }}
      >
        Mark first item
      </button>
      <output>{JSON.stringify(draft.viewedHunkIds)}</output>
    </>
  )
}

describe('review updates group', () => {
  it('gathers updated sections and dropped edits ahead of the regular groups', () => {
    const removed = compareReviewSections(
      sectionPull(base, both),
      grouped(sectionPull(base, first)),
    )
    expect(updatesGroup(pull, changes)).toMatchObject({
      id: UPDATES_GROUP_ID,
      hunkIds: [required(secondHunk).id],
      fileIds: [fileId],
    })
    expect(updatesGroup(pull, { ...changes, sections: [], removed: [] })).toBeUndefined()
    expect(updatesGroup(pull, removed)).toMatchObject({ hunkIds: [], fileIds: [] })
  })

  it('shows edited sections as their changes since review unless whole sections are requested', () => {
    const group = required(updatesGroup(pull, changes))
    const since = reviewItems({ pull, displayPull: pull, group, changes, full: false })
    expect(since.items.map((item) => item.id)).toEqual([`${fileId}:since-review:0`])
    expect(since.synthetic.get(`${fileId}:since-review:0`)).toBe('interdiff')
    expect(since.targets).toEqual([
      {
        hunkId: required(secondHunk).id,
        itemId: `${fileId}:since-review:0`,
        path: 'shared.ts',
        line: 6,
        side: DiffSide.right,
        state: 'changed',
      },
    ])
    const full = reviewItems({ pull, displayPull: pull, group, changes, full: true })
    expect(full.items.map((item) => item.id)).toEqual([fileId])
    expect(full.synthetic.size).toBe(0)
    expect(full.targets[0]).toMatchObject({ itemId: fileId, line: 6, side: DiffSide.right })
  })
})

describe('review updates display items', () => {
  it('joins edited sections from one Git hunk into one item when they share only context', () => {
    const context = (text: string) => ({ kind: LineKind.context, text })
    const overlapping: ReviewChanges = {
      ...changes,
      sections: [
        {
          hunkId: required(firstHunk).id,
          state: 'changed',
          interdiff: {
            header: '@@ -1,4 +1,4 @@',
            lines: [
              { kind: LineKind.removed, text: 'a' },
              { kind: LineKind.added, text: 'b' },
              ...['x', 'y', 'z'].map(context),
            ],
          },
        },
        {
          hunkId: required(secondHunk).id,
          state: 'changed',
          interdiff: {
            header: '@@ -3,4 +3,4 @@',
            lines: [
              ...['y', 'z'].map(context),
              { kind: LineKind.removed, text: 'q' },
              { kind: LineKind.added, text: 'r' },
              context('w'),
            ],
          },
        },
      ],
    }
    const group = required(updatesGroup(pull, overlapping))
    const display = reviewItems({
      pull,
      displayPull: pull,
      group,
      changes: overlapping,
      full: false,
    })
    expect(display.items.map((item) => item.id)).toEqual([`${fileId}:since-review:0`])
    expect(display.targets.map(({ line, side }) => ({ line, side }))).toEqual([
      { line: 1, side: DiffSide.right },
      { line: 5, side: DiffSide.right },
    ])
  })

  it('renders dropped edits as display-only items', () => {
    const current = grouped(sectionPull(base, first))
    const removed = compareReviewSections(sectionPull(base, both), current)
    const group = required(updatesGroup(current, removed))
    const display = reviewItems({
      pull: current,
      displayPull: current,
      group,
      changes: removed,
      full: false,
    })
    expect(display.items.map((item) => item.id)).toEqual(['removed:shared.ts:0'])
    expect(display.synthetic.get('removed:shared.ts:0')).toBe('removed')
    expect(display.targets).toEqual([])
  })
})

describe('review updates workflow', () => {
  it('opens on the updates group and moves on once its sections are viewed', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('selected').textContent).toBe(UPDATES_GROUP_ID)
    expect(screen.getByText('Updated since your review')).toBeTruthy()
    expect(screen.getByText('0/1 sections viewed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark updated section' }))
    expect(screen.getByRole('status').textContent).toBe(JSON.stringify([required(secondHunk).id]))
    expect(screen.getByTestId('selected').textContent).toBe('one')
    expect(screen.queryByText('0/1 sections viewed')).toBeNull()
  })

  it('marks the sections behind a display-only item through its viewed toggle', () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('items').textContent).toBe(`${fileId}:since-review:0`)
    fireEvent.click(screen.getByRole('button', { name: 'Mark first item' }))
    expect(screen.getByRole('status').textContent).toBe(JSON.stringify([required(secondHunk).id]))
  })

  it('dismisses review updates from the sidebar', () => {
    const onDismiss = vi.fn()
    render(
      <MemoryRouter>
        <GroupSidebar
          pull={pull}
          draft={emptyDraft()}
          changes={changes}
          updates={updatesGroup(pull, changes)}
          inboxUrl="/"
          submitting={false}
          organizing={false}
          onSelect={() => {}}
          onRegenerate={() => {}}
          onNotice={() => {}}
          onDismissUpdates={onDismiss}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss review updates' }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.getByText(/· 1 updated/)).toBeTruthy()
  })
})

describe('section controls in the diff', () => {
  it('places each section control after its last edited line and keeps discussions off display-only items', () => {
    const group = required(updatesGroup(pull, changes))
    const display = reviewItems({ pull, displayPull: pull, group, changes, full: false })
    const annotated = annotateDiscussions({
      items: display.items,
      pull,
      comments: [],
      editor: null,
      sections: {
        targets: display.targets,
        viewed: new Set(),
        current: required(secondHunk).id,
      },
    })
    const annotations = required(annotated.items[0]).annotations ?? []
    expect(annotations).toHaveLength(1)
    expect(required(annotations[0]).metadata).toMatchObject({
      line: 6,
      side: DiffSide.right,
      threads: [],
      sections: [{ hunkId: required(secondHunk).id, viewed: false, current: true }],
    })
  })

  it('marks the current section with V and moves to the next unviewed one', () => {
    const targets: SectionTarget[] = [firstHunk, secondHunk].map((hunk, index) => ({
      hunkId: required(hunk).id,
      itemId: fileId,
      path: 'shared.ts',
      line: index ? 6 : 2,
      side: DiffSide.right,
    }))
    const scrollTo = vi.fn()
    function Cursor() {
      const [viewed, setViewed] = useState(() => new Set<string>())
      const cursor = useSectionCursor({
        targets,
        viewed,
        items: [],
        markSectionViewed: (id) => {
          setViewed((previous) => new Set(previous).add(id))
          return false
        },
        setFileCollapsed: () => {},
        viewerRef: { current: { scrollTo } },
        enabled: true,
      })
      return (
        <>
          <p data-testid="current">{cursor.section ?? 'none'}</p>
          <p data-testid="viewed">{[...viewed].join(',')}</p>
          <textarea aria-label="Comment" />
        </>
      )
    }
    render(<Cursor />)
    fireEvent.keyDown(window, { key: 'v' })
    expect(screen.getByTestId('viewed').textContent).toBe(required(firstHunk).id)
    expect(screen.getByTestId('current').textContent).toBe(required(secondHunk).id)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ id: fileId, lineNumber: 6 }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'v' })
    expect(screen.getByTestId('viewed').textContent).toBe(required(firstHunk).id)
    fireEvent.keyDown(window, { key: 'v', metaKey: true })
    expect(screen.getByTestId('viewed').textContent).toBe(required(firstHunk).id)
  })
})

describe('review updates in the pull header', () => {
  it('links the update count to the updates group and explains the baseline', () => {
    const onChanges = vi.fn()
    render(
      <ReviewPullDetails
        pull={pull}
        onDescription={() => {}}
        onReload={() => {}}
        reloading={false}
        organizing={false}
        onStatus={() => {}}
        changes={{ ...changes, incompletePaths: ['big.ts'] }}
        onChanges={onChanges}
      />,
    )
    const button = screen.getByRole('button', { name: /1 updated since/ })
    expect(button.getAttribute('title')).toContain('1 file has incomplete patches')
    fireEvent.click(button)
    expect(onChanges).toHaveBeenCalledOnce()
  })
})
