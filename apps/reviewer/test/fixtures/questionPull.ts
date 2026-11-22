import { LineKind, Provider, type PullRequest } from '../../shared/domain/types'
import { fixturePull } from './pull'
import { required } from './required'

export function questionPull(): PullRequest {
  const pull = fixturePull()
  const [permissions, audit, slug, docs] = pull.groups
  const route = required(pull.files.find((file) => file.path === 'src/routes/projects.ts'))
  const tests = required(pull.files.find((file) => file.path === 'test/projects.test.ts'))
  return {
    ...pull,
    groupingSource: Provider.codex,
    groups: [
      {
        ...required(permissions),
        claim: 'Project updates require an editor or admin in the same organization.',
        question: 'Can a viewer or an editor from another organization update a project?',
        supportHunkIds: route.hunks
          .filter((hunk) => !hunk.lines.some((line) => line.text.includes('ForbiddenError')))
          .map((hunk) => hunk.id),
        testHunkIds: tests.hunks.map((hunk) => hunk.id),
      },
      {
        ...required(audit),
        claim: 'The audit helper returns the entry it records.',
        question: 'Do callers need the recorded entry?',
      },
      { ...required(docs), lane: 'evidence' },
      { ...required(slug), lane: 'mechanical' },
    ],
  }
}

export function supportingLine(pull: PullRequest) {
  const file = required(pull.files.find((file) => file.path === 'src/routes/projects.ts'))
  const hunk = required(
    file.hunks.find((hunk) => pull.groups[0]?.supportHunkIds?.includes(hunk.id)),
  )
  return {
    path: file.path,
    line: required(required(hunk.lines.find((line) => line.kind === LineKind.added)).newLine),
  }
}
