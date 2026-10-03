import { describe, expect, it } from 'vitest'
import {
  DiffSide,
  LineKind,
  Provider,
  type PullDiscussions,
  type ReviewThread,
} from '../shared/types'
import {
  annotateDiscussions,
  discussionGroup,
  groupViewed,
  nextUnviewedGroup,
} from '../src/discussions'
import { diffItems } from '../src/diffItems'
import { restoreDraft } from '../src/drafts'
import { fixturePull } from './fixtures/pull'
import { parseFile } from '../shared/diff'

function thread(params: { path: string; line: number; side: DiffSide; id: string }): ReviewThread {
  return {
    ...params,
    originalLine: params.line,
    resolved: true,
    outdated: false,
    canReply: true,
    comments: [
      {
        id: '42',
        author: 'reviewer',
        body: 'Please check this.',
        url: 'https://github.com/owner/repo/pull/123#discussion_r42',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  }
}
function discussionFixture() {
  const pull = fixturePull()
  const group = pull.groups[0]
  const file = pull.files.find((file) => group?.fileIds.includes(file.id))
  const line = file?.hunks.flatMap((hunk) => hunk.lines).find((line) => line.newLine != null)
  if (!group || !file || line?.newLine == null) throw new Error('Fixture needs a line')
  const editor = {
    id: 'editing-first',
    headSha: pull.headSha,
    path: file.path,
    line: line.newLine,
    side: DiffSide.right,
  }
  return { pull, items: diffItems(pull, group), file, editor }
}
describe('inline discussions', () => {
  it('finds the exact hunk group on the requested side when a file belongs to multiple groups', () => {
    const pull = fixturePull()
    const file = parseFile({
      path: 'shared.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      patch: '@@ -10 +20 @@\n-old-first\n+new-first\n@@ -20 +30 @@\n-old-second\n+new-second',
    })
    const base = pull.groups[0]
    const [first, second] = file.hunks
    if (!base || !first || !second) throw new Error('Fixture needs two hunks and a group')
    pull.groupingSource = Provider.codex
    pull.files = [file]
    pull.groups = [
      { ...base, id: 'unrelated', fileIds: ['another-file'], hunkIds: [] },
      { ...base, id: 'first', fileIds: [file.id], hunkIds: [first.id] },
      { ...base, id: 'second', fileIds: [file.id], hunkIds: [second.id] },
    ]
    expect(discussionGroup({ pull, path: file.path, line: 20, side: DiffSide.left })?.id).toBe(
      'second',
    )
    expect(discussionGroup({ pull, path: file.path, line: 20, side: DiffSide.right })?.id).toBe(
      'first',
    )
    expect(discussionGroup({ pull, path: file.path, line: 30, side: DiffSide.right })?.id).toBe(
      'second',
    )
    expect(discussionGroup({ pull, path: file.path, line: 999, side: DiffSide.right })?.id).toBe(
      'first',
    )
    expect(discussionGroup({ pull, path: file.path })?.id).toBe('first')
    expect(
      discussionGroup({ pull, path: 'missing.ts', line: 20, side: DiffSide.right }),
    ).toBeUndefined()
    expect(
      discussionGroup({
        pull: { ...pull, groupingSource: 'files' },
        path: file.path,
        line: 20,
        side: DiffSide.left,
      })?.id,
    ).toBe('second')
  })
  it('publishes composer and draft changes while retaining stable versions for equivalent content', () => {
    const { pull, items, file, editor } = discussionFixture()
    const params = { pull, items, comments: [], editor: null }
    const empty = annotateDiscussions(params)
    const open = annotateDiscussions({ ...params, editor })
    const repeated = annotateDiscussions({ ...params, editor: { ...editor } })
    const version = (result: typeof empty) =>
      result.items.find((item) => item.id === file.id)?.version
    expect(empty.items.every((item) => Number.isSafeInteger(item.version))).toBe(true)
    expect(version(open)).not.toBe(version(empty))
    expect(version(repeated)).toBe(version(open))
    expect(version(annotateDiscussions(params))).toBe(version(empty))
    for (const item of empty.items.filter((item) => item.id !== file.id)) {
      expect(open.items.find((updated) => updated.id === item.id)?.version).toBe(item.version)
    }
    const comments = [
      { ...editor, body: 'First comment' },
      { ...editor, id: 'second', body: 'Another comment on the same line' },
    ]
    const saved = annotateDiscussions({ ...params, comments })
    const edited = annotateDiscussions({ ...params, comments, editor })
    expect(version(saved)).not.toBe(version(open))
    expect(version(edited)).not.toBe(version(saved))
    const editedItem = edited.items.find((item) => item.id === file.id)
    expect(editedItem?.annotations?.[0]?.metadata).toMatchObject({
      editingId: editor.id,
      drafts: [{ id: editor.id }, { id: 'second' }],
    })
    expect(
      version(
        annotateDiscussions({
          ...params,
          comments: comments.map((comment) => ({ ...comment, body: `${comment.body} Updated` })),
        }),
      ),
    ).not.toBe(version(saved))
    expect(version(annotateDiscussions({ ...params, comments: comments.slice(1) }))).not.toBe(
      version(saved),
    )
  })
  it('publishes thread replies, resolution changes, and changed patch geometry', () => {
    const { pull, items, file, editor } = discussionFixture()
    const current = thread({ id: 'thread', path: file.path, line: editor.line, side: editor.side })
    const params = {
      pull,
      items,
      editor: null,
      comments: [],
      discussions: { headSha: pull.headSha, baseSha: pull.baseSha, threads: [current] },
    }
    const original = annotateDiscussions(params)
    const version = (result: typeof original) =>
      result.items.find((item) => item.id === file.id)?.version
    const unresolved = annotateDiscussions({
      ...params,
      discussions: { ...params.discussions, threads: [{ ...current, resolved: false }] },
    })
    const replied = annotateDiscussions({
      ...params,
      discussions: {
        ...params.discussions,
        threads: [
          {
            ...current,
            comments: [
              ...current.comments,
              {
                id: '43',
                author: 'author',
                body: 'Fixed this.',
                createdAt: '2026-01-02T00:00:00Z',
                url: 'https://github.com/owner/repo/pull/123#discussion_r43',
              },
            ],
          },
        ],
      },
    })
    expect(version(unresolved)).not.toBe(version(original))
    expect(version(replied)).not.toBe(version(original))
    const changedPatch = annotateDiscussions({
      ...params,
      items: items.map((item) =>
        item.type !== 'diff'
          ? item
          : {
              ...item,
              fileDiff: {
                ...item.fileDiff,
                hunks: item.fileDiff.hunks.map((hunk) => ({
                  ...hunk,
                  additionStart: hunk.additionStart + 1,
                  deletionStart: hunk.deletionStart + 1,
                })),
              },
            },
      ),
    })
    expect(version(changedPatch)).not.toBe(version(original))
  })
  it('keeps stale local draft and composer coordinates away from the current revision', () => {
    const { pull, items, editor } = discussionFixture()
    const result = annotateDiscussions({
      pull,
      items,
      editor: { ...editor, headSha: 'previous-head' },
      comments: [
        { ...editor, headSha: 'previous-head', body: 'Keep the draft, but not its old anchor' },
      ],
    })
    expect(result.items.every((item) => !item.annotations?.length)).toBe(true)
  })
  it('anchors resolved threads and draft composers to distinct original/updated lines', () => {
    const pull = fixturePull()
    const file = pull.files.find((file) =>
      file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === LineKind.removed)),
    )
    const group = pull.groups.find((group) => file && group.fileIds.includes(file.id))
    if (!file || !group) throw new Error('Fixture needs an edited file')
    const hunk = file.hunks.find((hunk) => group.hunkIds.includes(hunk.id))
    const line = hunk?.lines.find((line) => line.oldLine != null && line.newLine != null)
    if (line?.oldLine == null || line.newLine == null) throw new Error('Fixture needs context')
    const left = thread({
      id: 'original',
      path: file.path,
      line: line.oldLine,
      side: DiffSide.left,
    })
    const right = thread({
      id: 'updated',
      path: file.path,
      line: line.newLine,
      side: DiffSide.right,
    })
    const discussions: PullDiscussions = {
      headSha: pull.headSha,
      baseSha: pull.baseSha,
      threads: [left, right],
    }
    const editor = {
      id: 'draft',
      headSha: pull.headSha,
      path: file.path,
      line: line.newLine,
      side: DiffSide.right,
    }
    const annotated = annotateDiscussions({
      items: diffItems(pull, group),
      pull,
      discussions,
      comments: [],
      editor,
    })
    const item = annotated.items.find((item) => item.id === file.id)
    if (item?.type !== 'diff') throw new Error('Missing annotated diff')
    expect(item.annotations).toMatchObject([
      {
        side: 'deletions',
        lineNumber: line.oldLine,
        metadata: { threads: [{ id: 'original', resolved: true }] },
      },
      {
        side: 'additions',
        lineNumber: line.newLine,
        metadata: { threads: [{ id: 'updated', resolved: true }], editingId: 'draft' },
      },
    ])
    expect(annotated.unplaced).toEqual([])
  })
  it('keeps outdated or mismatched-revision threads away from current code lines', () => {
    const pull = fixturePull()
    const group = pull.groups[0]
    const file = pull.files.find((file) => group?.fileIds.includes(file.id))
    const line = file?.hunks.flatMap((hunk) => hunk.lines).find((line) => line.newLine != null)
    if (!group || !file || line?.newLine == null) throw new Error('Fixture needs a line')
    const current = thread({
      id: 'current',
      path: file.path,
      line: line.newLine,
      side: DiffSide.right,
    })
    const outdated = { ...current, id: 'outdated', outdated: true }
    const params = { items: diffItems(pull, group), pull, comments: [], editor: null }
    const result = annotateDiscussions({
      ...params,
      discussions: { headSha: pull.headSha, baseSha: pull.baseSha, threads: [current, outdated] },
    })
    expect(result.unplaced.map((thread) => thread.id)).toEqual(['outdated'])
    const mismatched = annotateDiscussions({
      ...params,
      discussions: { headSha: 'another-commit', baseSha: pull.baseSha, threads: [current] },
    })
    expect(mismatched.unplaced.map((thread) => thread.id)).toEqual(['current'])
    expect(mismatched.items.every((item) => !item.annotations?.length)).toBe(true)
  })
  it('marks a group viewed only when every file is viewed, including files shared by groups', () => {
    const pull = fixturePull()
    const group = { ...pull.groups[0], fileIds: ['file-a', 'file-b'] }
    expect(groupViewed(group, ['file-a'])).toBe(false)
    expect(groupViewed(group, ['file-a', 'file-b'])).toBe(true)
    expect(groupViewed({ ...group, fileIds: ['file-a'] }, ['file-a'])).toBe(true)
    expect(groupViewed({ ...group, fileIds: [] }, [])).toBe(false)
    expect(groupViewed(group, ['file-b'])).toBe(false)
  })
  it('advances in group order past viewed groups, including groups completed by shared files', () => {
    const base = fixturePull().groups[0]
    if (!base) throw new Error('Fixture needs a group')
    const groups = [
      { ...base, id: 'selected', fileIds: ['shared'] },
      { ...base, id: 'also-completed', fileIds: ['shared'] },
      { ...base, id: 'already-viewed', fileIds: ['previous'] },
      { ...base, id: 'partly-viewed', fileIds: ['shared', 'remaining'] },
      { ...base, id: 'later', fileIds: ['later-file'] },
    ]
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'selected',
        viewedFileIds: ['shared', 'previous'],
      })?.id,
    ).toBe('partly-viewed')
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'selected',
        viewedFileIds: ['shared', 'previous', 'remaining'],
      })?.id,
    ).toBe('later')
  })
  it('wraps to earlier unviewed groups and stays put when none remain or selection is missing', () => {
    const base = fixturePull().groups[0]
    if (!base) throw new Error('Fixture needs a group')
    const groups = [
      { ...base, id: 'first', fileIds: ['first-file'] },
      { ...base, id: 'second', fileIds: ['second-file'] },
      { ...base, id: 'last', fileIds: ['last-file'] },
    ]
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'last',
        viewedFileIds: ['last-file'],
      })?.id,
    ).toBe('first')
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'last',
        viewedFileIds: ['last-file', 'first-file'],
      })?.id,
    ).toBe('second')
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'last',
        viewedFileIds: ['first-file', 'second-file', 'last-file'],
      }),
    ).toBeUndefined()
    expect(
      nextUnviewedGroup({
        groups,
        selectedGroupId: 'missing',
        viewedFileIds: [],
      }),
    ).toBeUndefined()
    expect(
      nextUnviewedGroup({
        groups: [groups[0]],
        selectedGroupId: 'first',
        viewedFileIds: [],
      }),
    ).toBeUndefined()
  })
  it('restores older drafts without losing general notes or marking partially reviewed files viewed', () => {
    const pull = fixturePull()
    const file = parseFile({
      path: 'multiple.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      patch: '@@ -1 +1 @@\n-old\n+new\n@@ -20 +20 @@\n-old\n+new',
    })
    pull.files = [file]
    const base = {
      summary: 'Summary',
      comments: [
        {
          id: 'general',
          body: 'Preserve this feedback.',
          headSha: pull.headSha,
          groupTitle: 'Permissions',
        },
      ],
    }
    const partial = restoreDraft(pull, {
      ...base,
      viewedHunkIds: file.hunks.slice(0, 1).map((hunk) => hunk.id),
    })
    expect(partial.summary).toContain('Preserve this feedback.')
    expect(partial.comments).toEqual([])
    expect(partial.viewedFileIds).not.toContain(file.id)
    const complete = restoreDraft(pull, {
      ...base,
      viewedHunkIds: file.hunks.map((hunk) => hunk.id),
    })
    expect(complete.viewedFileIds).toContain(file.id)
  })
})
