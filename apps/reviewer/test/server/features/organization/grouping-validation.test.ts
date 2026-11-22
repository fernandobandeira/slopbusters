import { describe, expect, it } from 'vitest'
import { UserError } from '../../../../server/errors'
import { parseFile } from '../../../../server/features/diff'
import { organizePull, validateGrouping } from '../../../../server/features/organization/organize'
import { pullSchema } from '../../../../shared/api/reviewSchemas'
import { Priority, Provider } from '../../../../shared/domain/types'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'
import { required } from '../../../fixtures/required'

function change(path: string, line: string) {
  return parseFile({
    path,
    status: 'added',
    additions: 1,
    deletions: 0,
    patch: `@@ -0,0 +1 @@\n+${line}`,
  })
}

function fixture() {
  const key = change('access.ts', 'export const canEdit = (role) => role === "editor"')
  const support = change('route.ts', 'if (!canEdit(viewer.role)) return forbidden()')
  const test = change('access.test.ts', 'expect(canEdit("guest")).toBe(false)')
  const notes = change('README.md', 'Editors may update projects.')
  const image = parseFile({ path: 'roles.png', status: 'added', additions: 0, deletions: 0 })
  const section = (file: typeof key) => required(file.hunks[0]).id
  const pull = { ...fixturePull(), files: [key, support, test, notes, image], transfers: [] }
  const keyChange = {
    title: 'Who can edit projects',
    claim: 'Project updates require the editor role.',
    question: 'Should guests be blocked from updating projects?',
    priority: 1,
    keyHunkIds: [section(key)],
    supportHunkIds: [section(support)],
    evidenceHunkIds: [section(test)],
  }
  const aside = {
    title: 'Update the docs',
    lane: 'mechanical',
    reason: 'The wording reflects the editor role.',
    hunkIds: [section(notes)],
  }
  return { pull, keyChange, aside, key, support, test, notes, image }
}

describe('key change grouping', () => {
  it('maps key change roles, then set-aside groups, then unavailable files', () => {
    const { pull, keyChange, aside, key, support, test, notes, image } = fixture()

    const groups = validateGrouping(pull, { keyChanges: [keyChange], rest: [aside] })

    expect(groups).toEqual([
      {
        id: 'group-0',
        title: keyChange.title,
        priority: Priority.high,
        claim: keyChange.claim,
        question: keyChange.question,
        reason: keyChange.claim,
        hunkIds: [
          ...keyChange.keyHunkIds,
          ...keyChange.supportHunkIds,
          ...keyChange.evidenceHunkIds,
        ],
        supportHunkIds: keyChange.supportHunkIds,
        testHunkIds: keyChange.evidenceHunkIds,
        fileIds: [key.id, support.id, test.id],
      },
      {
        ...aside,
        id: 'group-1',
        priority: Priority.low,
        fileIds: [notes.id],
      },
      {
        id: `unavailable-${image.id}`,
        title: image.path,
        priority: Priority.normal,
        reason: 'No text patch is available. Inspect this file on GitHub.',
        hunkIds: [],
        fileIds: [image.id],
      },
    ])
    expect(pullSchema.parse({ ...pull, groups }).groups).toEqual(groups)
  })

  it('keeps the order of key changes and maps all three priorities', () => {
    const { pull, keyChange, aside } = fixture()
    const keyChanges = [
      { ...keyChange, supportHunkIds: [], evidenceHunkIds: [] },
      {
        title: 'Route response',
        claim: 'The route returns a forbidden response for guests.',
        question: 'Is forbidden the expected response here?',
        priority: 2,
        keyHunkIds: keyChange.supportHunkIds,
        supportHunkIds: [],
        evidenceHunkIds: [],
      },
      {
        title: 'Guest test',
        claim: 'The test expects a guest to be blocked.',
        question: 'Does the test name describe the assertion?',
        priority: 3,
        keyHunkIds: keyChange.evidenceHunkIds,
        supportHunkIds: [],
        evidenceHunkIds: [],
      },
    ]

    const groups = validateGrouping(pull, { keyChanges, rest: [aside] })

    expect(groups.slice(0, 3).map(({ title, priority }) => [title, priority])).toEqual([
      [keyChanges[0]?.title, Priority.high],
      [keyChanges[1]?.title, Priority.normal],
      [keyChanges[2]?.title, Priority.low],
    ])
  })

  it('still accepts a saved grouping without question fields or lanes in the pull API', () => {
    const saved = { ...fixturePull(), groupingSource: Provider.codex }

    expect(pullSchema.parse(saved)).toEqual(saved)
  })
})

it('keeps a key change that asks nothing as a review group without a question', () => {
  const { pull, keyChange, aside } = fixture()
  const { question: _, ...unasked } = keyChange

  const [group, next] = validateGrouping(pull, { keyChanges: [unasked], rest: [aside] })

  expect(group).toMatchObject({ claim: keyChange.claim, priority: Priority.high })
  expect(group).not.toHaveProperty('question')
  expect(group).not.toHaveProperty('lane')
  expect(next?.lane).toBe(aside.lane)
})

describe('invalid key change groupings', () => {
  const { pull, keyChange, aside } = fixture()

  it.each([
    [
      'an unknown section',
      { keyChanges: [keyChange], rest: [{ ...aside, hunkIds: ['invented'] }] },
      'does not exist',
    ],
    [
      'a key change without any key sections',
      { keyChanges: [{ ...keyChange, keyHunkIds: [] }], rest: [aside] },
      'returned an invalid grouping',
    ],
    [
      'a question attached to a set-aside group',
      { keyChanges: [keyChange], rest: [{ ...aside, question: 'Should guests be blocked?' }] },
      'returned an invalid grouping',
    ],
  ] as const)('rejects %s with a readable error', (_label, reply, message) => {
    expect(() => validateGrouping(pull, reply)).toThrow(UserError)
    expect(() => validateGrouping(pull, reply)).toThrow(message)
  })
})

it('keeps the first placement and sets aside missing sections and key changes that lose their keys', async () => {
  const { pull, keyChange, aside } = fixture()
  const shared = change('editor.ts', 'const editor = "editor"')
  pull.files.push(shared)
  const sharedId = required(shared.hunks[0]).id
  const retained = {
    ...keyChange,
    supportHunkIds: [...keyChange.keyHunkIds, sharedId],
    evidenceHunkIds: [...keyChange.evidenceHunkIds, sharedId],
  }
  const withoutKeys = {
    ...keyChange,
    title: 'Check the route',
    keyHunkIds: keyChange.keyHunkIds,
    supportHunkIds: aside.hunkIds,
  }
  const { turns } = recordingTurns(() => ({ keyChanges: [retained, withoutKeys], rest: [aside] }))

  const groups = await organizePull(
    turns,
    pull,
    { provider: Provider.codex, model: 'test' },
    {
      signal: new AbortController().signal,
    },
  )

  expect(groups[0]).toMatchObject({
    question: keyChange.question,
    hunkIds: [...keyChange.keyHunkIds, sharedId, ...keyChange.evidenceHunkIds],
    supportHunkIds: [sharedId],
    testHunkIds: keyChange.evidenceHunkIds,
  })
  expect(groups.filter((group) => group.question)).toHaveLength(1)
  const orphaned = groups.find((group) => group.hunkIds.includes(required(aside.hunkIds[0])))
  expect(orphaned).toMatchObject({
    title: withoutKeys.title,
    lane: 'implementation',
    hunkIds: aside.hunkIds,
  })
  expect(orphaned?.reason).toContain('already assigned to earlier ones')
  const omitted = groups.find((group) =>
    group.hunkIds.includes(required(keyChange.supportHunkIds[0])),
  )
  expect(omitted).toMatchObject({
    title: 'Sections the model did not place',
    lane: 'implementation',
    hunkIds: keyChange.supportHunkIds,
  })
  expect(omitted?.reason).toContain('did not assign')
  expect(groups.flatMap((group) => group.hunkIds).sort()).toEqual(
    pull.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)).sort(),
  )
})
