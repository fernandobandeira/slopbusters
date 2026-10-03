import { describe, expect, it } from 'vitest'
import { createTwoFilesPatch } from 'diff'
import { parseFile, detectTransfers } from '../shared/diff'
import { buildGitHubReview, exportFeedback, groupChangeTotals } from '../shared/review'
import { validateGrouping } from '../server/organize'
import { fixturePull } from './fixtures/pull'
import {
  DiffSide,
  LineKind,
  Priority,
  ReviewEvent,
  TransferKind,
  type ReviewDraft,
} from '../shared/types'
import { diffItems } from '../src/diffItems'
import { inboxPulls } from '../src/inbox'

const block =
  'export function slug(value: string) {\n  return value.trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n'
function changedFile(path: string, old: string, current: string) {
  const raw = createTwoFilesPatch(path, path, old, current)
  const patch = raw.slice(raw.indexOf('@@'))
  const additions = patch.split('\n').filter((line) => line.startsWith('+')).length
  const deletions = patch.split('\n').filter((line) => line.startsWith('-')).length
  return parseFile({ path, status: 'modified', patch, additions, deletions, oldContent: old })
}

describe('diff mapping and transfer detection', () => {
  it('keeps original and updated locations distinct', () => {
    const file = parseFile({
      path: 'example.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: '@@ -10,3 +10,4 @@\n first\n-old\n+replacement\n+extra\n last',
    })
    const lines = file.hunks.flatMap((hunk) => hunk.lines)
    expect(lines.find((line) => line.kind === LineKind.removed)).toMatchObject({
      oldLine: 11,
      newLine: null,
    })
    expect(
      lines.filter((line) => line.kind === LineKind.added).map((line) => line.newLine),
    ).toEqual([11, 12])
    expect(file.coverage).toBe('complete')
  })
  it('distinguishes an exact move from a copy of retained code', () => {
    const destination = changedFile('slug.ts', '', block)
    expect(detectTransfers([changedFile('utils.ts', block, ''), destination])).toMatchObject([
      { kind: TransferKind.moved, fromLine: 1, toLine: 1, lineCount: 6 },
    ])
    expect(
      detectTransfers([
        changedFile(
          'utils.ts',
          `${block}\nexport const version = 1;\n`,
          `${block}\nexport const version = 2;\n`,
        ),
        destination,
      ]),
    ).toMatchObject([{ kind: TransferKind.copied }])
  })
  it('does not mark short boilerplate or changed text as an exact transfer', () => {
    expect(
      detectTransfers([
        changedFile('a.ts', '}\n}\n}\n}\n', ''),
        changedFile('b.ts', '', '}\n}\n}\n}\n'),
      ]),
    ).toEqual([])
    expect(
      detectTransfers([
        changedFile('a.ts', block, ''),
        changedFile(
          'b.ts',
          '',
          block.replace('trim()', 'trimEnd()').replace('toLowerCase()', 'toUpperCase()'),
        ),
      ]),
    ).toEqual([])
  })
  it('flags missing and truncated patches', () => {
    expect(
      parseFile({ path: 'image.png', status: 'modified', additions: 1, deletions: 1 }).coverage,
    ).toBe('unavailable')
    expect(
      parseFile({
        path: 'a',
        status: 'modified',
        additions: 10,
        deletions: 0,
        patch: '@@ -0,0 +1 @@\n+one',
      }).coverage,
    ).toBe('partial')
    expect(
      parseFile({
        path: 'broken.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        patch: '@@ -0,0 +1,2 @@\n+one\nbroken',
      }).coverage,
    ).toBe('unavailable')
    expect(
      parseFile({ path: 'binary.png', status: 'added', additions: 0, deletions: 0 }).coverage,
    ).toBe('unavailable')
  })
  it('renders groups with dense virtual rows and source coordinates', () => {
    const pr = fixturePull()
    expect(pr.transfers.map((item) => item.kind)).toEqual(
      expect.arrayContaining([TransferKind.moved, TransferKind.copied]),
    )
    for (const group of pr.groups) {
      const items = diffItems(pr, group)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items)
        if (item.type === 'diff') expect(item.fileDiff.hunks[0]?.unifiedLineStart).toBe(0)
    }
  })
})

describe('group validation', () => {
  it('counts only the selected hunks when groups share a file, and all hunks in file mode', () => {
    const pull = fixturePull()
    const file = parseFile({
      path: 'shared.ts',
      status: 'modified',
      additions: 3,
      deletions: 3,
      patch:
        '@@ -1,2 +1,3 @@\n context\n-old\n+first\n+second\n@@ -20,3 +21,2 @@\n unchanged\n-old-a\n-old-b\n+replacement',
    })
    const unrelated = parseFile({
      path: 'unrelated.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1 @@\n+unrelated',
    })
    const [first, second] = file.hunks
    if (!first || !second) throw new Error('Fixture needs two distinct hunks')
    pull.files = [file, unrelated]
    const group = {
      id: 'first-change',
      title: 'First change',
      priority: Priority.normal,
      reason: '',
      fileIds: [file.id],
      hunkIds: [first.id],
    }
    expect(groupChangeTotals(pull, group)).toEqual({ additions: 2, deletions: 1 })
    expect(
      groupChangeTotals(pull, { ...group, id: 'second-change', hunkIds: [second.id] }),
    ).toEqual({ additions: 1, deletions: 2 })
    expect(
      groupChangeTotals(pull, {
        ...group,
        id: `file-${file.id}`,
        hunkIds: file.hunks.map((hunk) => hunk.id),
      }),
    ).toEqual({ additions: 3, deletions: 3 })
    expect(groupChangeTotals(pull, { ...group, hunkIds: [first.id, first.id] })).toEqual({
      additions: 2,
      deletions: 1,
    })
  })

  it('requires every real diff hunk exactly once', () => {
    const pr = fixturePull()
    const ids = pr.files.flatMap((file) => file.hunks.map((hunk) => hunk.id))
    const group = {
      title: 'Complete review',
      priority: Priority.high,
      reason: 'Behavior changes',
      hunkIds: ids,
    }
    expect(validateGrouping(pr, { groups: [group] })[0]?.fileIds.length).toBe(pr.files.length)
    expect(() => validateGrouping(pr, { groups: [{ ...group, hunkIds: ids.slice(1) }] })).toThrow(
      'omitted',
    )
    expect(() => validateGrouping(pr, { groups: [group, group] })).toThrow('more than once')
    expect(() => validateGrouping(pr, { groups: [{ ...group, hunkIds: ['invented'] }] })).toThrow(
      'does not exist',
    )
  })
})

describe('review publishing', () => {
  function draft(): ReviewDraft {
    return { summary: 'Please revisit this condition.', viewedFileIds: [], comments: [] }
  }
  it('preserves LEFT and RIGHT coordinates and the review summary', () => {
    const pr = fixturePull()
    const file = pr.files.find((file) =>
      file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === LineKind.removed)),
    )
    if (!file) throw new Error('The fixture needs a deletion')
    const line = file.hunks.flatMap((hunk) => hunk.lines).find((line) => line.oldLine != null)
    if (line?.oldLine == null) throw new Error('Missing original location')
    const review = draft()
    review.comments.push({
      id: 'one',
      headSha: pr.headSha,
      body: 'Check this role.',
      path: file.path,
      line: line.oldLine,
      side: DiffSide.left,
    })
    review.summary = 'Add the missing role test.'
    const result = buildGitHubReview(pr, review, ReviewEvent.requestChanges)
    expect(result.comments[0]).toMatchObject({
      path: file.path,
      line: line.oldLine,
      side: DiffSide.left,
    })
    expect(result.body).toContain('Add the missing role test.')
    expect(exportFeedback(pr, review)).toContain('(original code)')
    review.comments[0] = { ...review.comments[0], headSha: 'old' }
    expect(() => buildGitHubReview(pr, review, ReviewEvent.comment)).toThrow('another revision')
  })
  it('refuses closed, invalid locations, and empty non-approval reviews', () => {
    const pr = fixturePull()
    expect(() =>
      buildGitHubReview({ ...pr, state: 'closed' }, draft(), ReviewEvent.comment),
    ).toThrow('Only open')
    const review = { ...draft(), summary: '' }
    expect(() => buildGitHubReview(pr, review, ReviewEvent.comment)).toThrow('Add feedback')
    expect(buildGitHubReview(pr, review, ReviewEvent.approve).event).toBe(ReviewEvent.approve)
    review.comments.push({
      id: 'invalid',
      headSha: pr.headSha,
      body: 'Check.',
      path: pr.files[0]?.path ?? 'missing.ts',
      line: 99999,
      side: DiffSide.right,
    })
    expect(() => buildGitHubReview(pr, review, ReviewEvent.comment)).toThrow('not in this diff')
  })
})

it('separates own PRs, other authors, and requested reviews', () => {
  const base = {
    number: 1,
    url: '',
    title: '',
    updatedAt: '',
    isDraft: false,
    headSha: '',
    labels: [],
    reviewRequested: false,
  }
  const inbox = {
    viewer: 'Reviewer',
    pulls: [
      { ...base, author: 'reviewer' },
      { ...base, number: 2, author: 'someone', reviewRequested: true },
    ],
  }
  expect(inboxPulls(inbox, 'mine').map((pr) => pr.number)).toEqual([1])
  expect(inboxPulls(inbox, 'others').map((pr) => pr.number)).toEqual([2])
  expect(inboxPulls(inbox, 'requested').map((pr) => pr.number)).toEqual([2])
})
