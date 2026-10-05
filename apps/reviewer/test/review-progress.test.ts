import { describe, expect, it } from 'vitest'
import {
  groupIsViewed,
  nextUnreviewedGroup,
  reviewedHunkIds,
  toggleViewedSections,
} from '../src/features/review/reviewProgress'
import type { ReviewDraft } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'
import { parseFile } from '../server/features/diff'

describe('reviewing sections separately', () => {
  it('keeps other sections of a shared file unviewed', () => {
    const pull = fixturePull()
    const file = parseFile({
      path: 'src/example.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      patch: '@@ -1,1 +1,1 @@\n-old first\n+new first\n@@ -10,1 +10,1 @@\n-old second\n+new second',
    })
    pull.files = [file]
    const first = {
      ...pull.groups[0]!,
      id: 'first',
      fileIds: [file.id],
      hunkIds: [file.hunks[0]!.id],
    }
    const second = { ...first, id: 'second', hunkIds: file.hunks.slice(1).map((hunk) => hunk.id) }
    let draft: ReviewDraft = { comments: [], summary: '', viewedFileIds: [] }
    draft = toggleViewedSections(pull, draft, first.hunkIds)
    expect(groupIsViewed(first, draft)).toBe(true)
    expect(groupIsViewed(second, draft)).toBe(false)
    expect(draft.viewedFileIds).not.toContain(file.id)
    expect(nextUnreviewedGroup([first, second], first.id, draft)).toBe(second)
    draft = toggleViewedSections(pull, draft, second.hunkIds)
    expect(draft.viewedFileIds).toContain(file.id)
    draft = toggleViewedSections(pull, draft, first.hunkIds)
    expect(groupIsViewed(first, draft)).toBe(false)
    expect(groupIsViewed(second, draft)).toBe(true)
  })

  it('restores file-based viewed state and stops advancing when every group is complete', () => {
    const pull = fixturePull()
    const draft: ReviewDraft = {
      comments: [],
      summary: '',
      viewedFileIds: pull.files.map((file) => file.id),
    }
    expect(reviewedHunkIds(pull, draft).size).toBe(pull.files.flatMap((file) => file.hunks).length)
    expect(nextUnreviewedGroup(pull.groups, pull.groups[0]!.id, draft)).toBeUndefined()
  })
})
