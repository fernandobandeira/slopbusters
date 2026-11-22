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
  const question = {
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
  return { pull, question, aside, key, support, test, notes, image }
}

describe('review question grouping', () => {
  it('maps question roles, then set-aside groups, then unavailable files', () => {
    const { pull, question, aside, key, support, test, notes, image } = fixture()

    const groups = validateGrouping(pull, { questions: [question], rest: [aside] })

    expect(groups).toEqual([
      {
        id: 'group-0',
        title: question.title,
        priority: Priority.high,
        claim: question.claim,
        question: question.question,
        reason: question.claim,
        hunkIds: [...question.keyHunkIds, ...question.supportHunkIds, ...question.evidenceHunkIds],
        supportHunkIds: question.supportHunkIds,
        testHunkIds: question.evidenceHunkIds,
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

  it('keeps the order of questions and maps all three priorities', () => {
    const { pull, question, aside } = fixture()
    const questions = [
      { ...question, supportHunkIds: [], evidenceHunkIds: [] },
      {
        title: 'Route response',
        claim: 'The route returns a forbidden response for guests.',
        question: 'Is forbidden the expected response here?',
        priority: 2,
        keyHunkIds: question.supportHunkIds,
        supportHunkIds: [],
        evidenceHunkIds: [],
      },
      {
        title: 'Guest test',
        claim: 'The test expects a guest to be blocked.',
        question: 'Does the test name describe the assertion?',
        priority: 3,
        keyHunkIds: question.evidenceHunkIds,
        supportHunkIds: [],
        evidenceHunkIds: [],
      },
    ]

    const groups = validateGrouping(pull, { questions, rest: [aside] })

    expect(groups.slice(0, 3).map(({ title, priority }) => [title, priority])).toEqual([
      [questions[0]?.title, Priority.high],
      [questions[1]?.title, Priority.normal],
      [questions[2]?.title, Priority.low],
    ])
  })

  it('still accepts a saved grouping without question fields or lanes in the pull API', () => {
    const saved = { ...fixturePull(), groupingSource: Provider.codex }

    expect(pullSchema.parse(saved)).toEqual(saved)
  })
})

describe('invalid review question groupings', () => {
  const { pull, question, aside } = fixture()

  it.each([
    [
      'an unknown section',
      { questions: [question], rest: [{ ...aside, hunkIds: ['invented'] }] },
      'does not exist',
    ],
    [
      'a question without any key sections',
      { questions: [{ ...question, keyHunkIds: [] }], rest: [aside] },
      'returned an invalid grouping',
    ],
    [
      'a question attached to a set-aside group',
      { questions: [question], rest: [{ ...aside, question: 'Should guests be blocked?' }] },
      'returned an invalid grouping',
    ],
  ] as const)('rejects %s with a readable error', (_label, reply, message) => {
    expect(() => validateGrouping(pull, reply)).toThrow(UserError)
    expect(() => validateGrouping(pull, reply)).toThrow(message)
  })
})

it('keeps the first placement and sets aside missing sections and questions that lose their keys', async () => {
  const { pull, question, aside } = fixture()
  const shared = change('editor.ts', 'const editor = "editor"')
  pull.files.push(shared)
  const sharedId = required(shared.hunks[0]).id
  const retained = {
    ...question,
    supportHunkIds: [...question.keyHunkIds, sharedId],
    evidenceHunkIds: [...question.evidenceHunkIds, sharedId],
  }
  const withoutKeys = {
    ...question,
    title: 'Check the route',
    keyHunkIds: question.keyHunkIds,
    supportHunkIds: aside.hunkIds,
  }
  const { turns } = recordingTurns(() => ({ questions: [retained, withoutKeys], rest: [aside] }))

  const groups = await organizePull(
    turns,
    pull,
    { provider: Provider.codex, model: 'test' },
    {
      signal: new AbortController().signal,
    },
  )

  expect(groups[0]).toMatchObject({
    question: question.question,
    hunkIds: [...question.keyHunkIds, sharedId, ...question.evidenceHunkIds],
    supportHunkIds: [sharedId],
    testHunkIds: question.evidenceHunkIds,
  })
  expect(groups.filter((group) => group.question)).toHaveLength(1)
  const orphaned = groups.find((group) => group.hunkIds.includes(required(aside.hunkIds[0])))
  expect(orphaned).toMatchObject({
    title: withoutKeys.title,
    lane: 'implementation',
    hunkIds: aside.hunkIds,
  })
  expect(orphaned?.reason).toContain('already assigned to earlier questions')
  const omitted = groups.find((group) =>
    group.hunkIds.includes(required(question.supportHunkIds[0])),
  )
  expect(omitted).toMatchObject({
    title: 'Sections the model did not place',
    lane: 'implementation',
    hunkIds: question.supportHunkIds,
  })
  expect(omitted?.reason).toContain('did not assign')
  expect(groups.flatMap((group) => group.hunkIds).sort()).toEqual(
    pull.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)).sort(),
  )
})
