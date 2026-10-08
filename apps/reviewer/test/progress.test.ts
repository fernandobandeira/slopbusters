import { describe, expect, it } from 'vitest'
import {
  hunkFingerprint,
  reviewedFingerprints,
  restoreProgress,
  emptyDraft,
} from '../server/features/progress'
import { LineKind } from '../shared/domain/types'
import { parseFile } from '../server/features/diff'
import { fixturePull } from './fixtures/pull'

describe('reviewed content fingerprints', () => {
  it('preserves reviewed content when hunk ids and line offsets change', () => {
    const pull = fixturePull()
    const file = pull.files[0]!
    const hunk = file.hunks[0]!
    const shifted = {
      ...hunk,
      id: 'shifted',
      header: '@@ -50,6 +50,9 @@',
      lines: hunk.lines.map((line) => ({
        ...line,
        id: `shifted-${line.id}`,
        oldLine: line.oldLine == null ? null : line.oldLine + 49,
        newLine: line.newLine == null ? null : line.newLine + 49,
      })),
    }
    expect(hunkFingerprint(file, shifted)).toBe(hunkFingerprint(file, hunk))
    const reviewed = reviewedFingerprints(pull, { ...emptyDraft(), viewedFileIds: [file.id] })
    const next = { ...pull, files: [{ ...file, hunks: [shifted] }] }
    expect(restoreProgress(next, emptyDraft(), reviewed)).toMatchObject({
      viewedFileIds: [file.id],
      viewedHunkIds: ['shifted'],
    })
  })
  it('invalidates edited context, paths, renames, and file statuses', () => {
    const file = fixturePull().files[0]!
    const hunk = file.hunks[0]!
    const original = hunkFingerprint(file, hunk)
    expect(
      hunkFingerprint(file, {
        ...hunk,
        lines: hunk.lines.map((line, index) =>
          index === hunk.lines.findIndex((line) => line.kind !== LineKind.context) - 1
            ? { ...line, text: line.text + 'changed' }
            : line,
        ),
      }),
    ).not.toBe(original)
    for (const change of [
      { path: 'different' },
      { previousPath: 'different' },
      { status: 'renamed' },
    ])
      expect(hunkFingerprint({ ...file, ...change }, hunk)).not.toBe(original)
  })
  it('retains unchanged hunks inside a changed file without marking the whole file viewed', () => {
    const pull = fixturePull()
    const file = parseFile({
      path: 'two-hunks.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      patch:
        '@@ -1,3 +1,3 @@\n first context\n-old first\n+new first\n tail\n@@ -20,3 +20,3 @@\n second context\n-old second\n+new second\n tail',
    })
    pull.files = [file]
    const reviewed = reviewedFingerprints(pull, { ...emptyDraft(), viewedFileIds: [file.id] })
    const modified = {
      ...file,
      hunks: file.hunks.map((hunk, index) =>
        index === 0
          ? { ...hunk, lines: hunk.lines.map((line) => ({ ...line, text: line.text + 'edited' })) }
          : hunk,
      ),
    }
    const result = restoreProgress({ ...pull, files: [modified] }, emptyDraft(), reviewed)
    expect(result.viewedFileIds).toEqual([])
    expect(result.viewedHunkIds).toEqual(file.hunks.slice(1).map((hunk) => hunk.id))
  })
  it('never infers that another identical hunk was reviewed or transfers ambiguous proof', () => {
    const pull = fixturePull()
    const original = pull.files[0]!
    const first = original.hunks[0]!
    const second = { ...first, id: 'duplicate-location' }
    pull.files = [{ ...original, hunks: [first, second] }]
    const draft = { ...emptyDraft(), viewedHunkIds: [first.id] }
    const proof = reviewedFingerprints(pull, draft)
    expect(proof.size).toBe(0)
    expect(restoreProgress(pull, draft, proof)).toMatchObject({
      viewedHunkIds: [first.id],
      viewedFileIds: [],
    })
    expect(
      restoreProgress(pull, emptyDraft(), new Set([hunkFingerprint(original, first)])),
    ).toMatchObject({ viewedHunkIds: [], viewedFileIds: [] })
    expect(
      restoreProgress({ ...pull, files: [original] }, emptyDraft(), proof).viewedHunkIds,
    ).toEqual([])
  })
  it('never carries partial or unavailable file proof across revisions', () => {
    const pull = fixturePull()
    const files = pull.files.slice(0, 2).map((file, index) => ({
      ...file,
      coverage: index === 0 ? ('partial' as const) : ('unavailable' as const),
    }))
    const previous = { ...pull, files }
    const draft = { ...emptyDraft(), viewedFileIds: files.map((file) => file.id) }
    const reviewed = reviewedFingerprints(previous, draft)
    expect(reviewed.size).toBe(0)
    expect(restoreProgress(previous, emptyDraft(), reviewed).viewedFileIds).toEqual([])
    expect(restoreProgress(previous, draft, reviewed).viewedFileIds).toEqual(draft.viewedFileIds)
  })
})
