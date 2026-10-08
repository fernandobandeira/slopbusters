import { required } from './fixtures/bob'
import { parsePatch } from 'diff'
import { describe, expect, it } from 'vitest'
import { splitChangeSections } from '../shared/domain/changeSections'
import { LineKind, Priority } from '../shared/domain/types'
import { sectionPull } from './fixtures/sections'
import { validateGrouping } from '../server/features/organization/organize'
import { diffItems } from '../src/lib/diffItems'
import { compareReviewSections } from '../server/features/sectionComparison'
import { emptyDraft, restoreProgress, reviewedFingerprints } from '../server/features/progress'

const base = 'function first() {\n  return 1\n}\n\nfunction second() {\n  return 2\n}\n'
const first = base.replace('return 1', 'return 10')
const both = first.replace('return 2', 'return 20')

describe('canonical change sections', () => {
  it('splits one Git hunk into separate groups without leaking other edits', () => {
    const pull = sectionPull(base, both)
    const file = required(pull.files[0])
    expect(parsePatch(`--- a/shared.ts\n+++ b/shared.ts\n${file.patch}`)[0]?.hunks).toHaveLength(1)
    expect(file.hunks).toHaveLength(2)
    const groups = validateGrouping(pull, {
      groups: file.hunks.map((hunk, index) => ({
        title: `Behavior ${index}`,
        priority: Priority.normal,
        reason: '',
        hunkIds: [hunk.id],
      })),
    })
    expect(groups.map((group) => group.fileIds)).toEqual([[file.id], [file.id]])
    for (const [index, group] of groups.entries()) {
      expect(diffItems(pull, group)).toHaveLength(1)
      const text = file.hunks
        .filter((hunk) => group.hunkIds.includes(hunk.id))
        .flatMap((hunk) => hunk.lines)
        .filter((line) => line.kind !== LineKind.context)
        .map((line) => line.text)
      expect(text).toEqual(
        index === 0 ? ['  return 1', '  return 10'] : ['  return 2', '  return 20'],
      )
    }
    expect(file.hunks.flatMap((hunk) => splitChangeSections(hunk))).toEqual(file.hunks)
    const combined = required(diffItems(pull, required(pull.groups[0]))[0])
    if (combined.type !== 'diff') throw new Error('Expected a diff')
    expect(combined.fileDiff.hunks).toHaveLength(1)
    expect(combined.fileDiff.hunks[0]?.additionCount).toBe(7)
    expect(combined.fileDiff.hunks[0]?.deletionCount).toBe(7)
  })

  it('splits added paragraphs with correct source coordinates and keeps every edit once', () => {
    const pull = sectionPull('', 'export const first = 1\n\nexport const second = 2\n')
    const file = required(pull.files[0])
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks.map((hunk) => hunk.header)).toEqual(['@@ -0,0 +1,2 @@', '@@ -0,0 +3,1 @@'])
    expect(file.hunks.flatMap((hunk) => hunk.lines).map((line) => line.newLine)).toEqual([1, 2, 3])
    expect(diffItems(pull, required(pull.groups[0]))).toHaveLength(1)
  })
})

describe('reviewed section comparison', () => {
  it('keeps reviewed edits when a nearby edit makes Git merge hunks', () => {
    const previous = sectionPull(base, first)
    const current = sectionPull(base, both)
    const proof = reviewedFingerprints(previous, {
      ...emptyDraft(),
      viewedFileIds: [required(previous.files[0]).id],
    })
    const draft = restoreProgress(current, emptyDraft(), proof)
    expect(draft.viewedHunkIds).toEqual([required(required(current.files[0]).hunks[0]).id])
    expect(draft.viewedFileIds).toEqual([])
    expect(compareReviewSections(previous, current).sections).toEqual([
      { hunkId: required(required(current.files[0]).hunks[1]).id, state: 'new' },
    ])
  })

  it('distinguishes edited sections from context changes and removed edits', () => {
    const previous = sectionPull(base, both)
    const edited = sectionPull(base, both.replace('return 20', 'return 30'))
    expect(compareReviewSections(previous, edited).sections).toEqual([
      { hunkId: required(required(edited.files[0]).hunks[1]).id, state: 'changed' },
    ])
    const shifted = {
      ...previous,
      files: previous.files.map((file) => ({
        ...file,
        hunks: file.hunks.map((hunk, index) =>
          index
            ? hunk
            : {
                ...hunk,
                lines: hunk.lines.map((line) =>
                  line.kind === LineKind.context && line.text === 'function first() {'
                    ? { ...line, text: 'function renamed() {' }
                    : line,
                ),
              },
        ),
      })),
    }
    expect(compareReviewSections(previous, shifted).sections).toEqual([
      { hunkId: required(required(shifted.files[0]).hunks[0]).id, state: 'context-changed' },
    ])
    const removed = compareReviewSections(previous, sectionPull(base, first))
    expect(removed.sections).toEqual([])
    expect(removed.removed).toMatchObject([
      { path: 'shared.ts', code: '-  return 2\n+  return 20' },
    ])
  })
})

describe('ambiguous and unavailable section comparison', () => {
  it('reserves exact matches before associating nearby new edits with old sections', () => {
    const previous = sectionPull('', 'old section\n')
    const current = sectionPull('', 'new section\n\nold section\n')
    expect(compareReviewSections(previous, current).sections).toEqual([
      { hunkId: required(required(current.files[0]).hunks[0]).id, state: 'new' },
    ])
    expect(compareReviewSections(previous, current).removed).toEqual([])
  })

  it('does not report unavailable or partial current patches as removed changes', () => {
    const previous = sectionPull(base, both)
    const current = {
      ...previous,
      files: previous.files.map((file) => ({ ...file, coverage: 'partial' as const, hunks: [] })),
    }
    expect(compareReviewSections(previous, current).removed).toEqual([])
  })
})
