import { groupChangeTotals } from '../../../shared/domain/review'
import {
  DiffSide,
  LineKind,
  type ChangeGroup,
  type ChangedFile,
  type PullRequest,
} from '../../../shared/domain/types'

export type OptionalSections = 'supporting' | 'test'

export function questionSections(group: ChangeGroup) {
  const tests = new Set(group.testHunkIds)
  const support = new Set(group.supportHunkIds)
  const sections = { key: [] as string[], supporting: [] as string[], test: [] as string[] }
  for (const id of group.hunkIds) {
    if (tests.has(id)) sections.test.push(id)
    else if (support.has(id)) sections.supporting.push(id)
    else sections.key.push(id)
  }
  return sections
}

export function questionSectionAt(
  group: ChangeGroup,
  file: ChangedFile,
  location: { line: number; side: DiffSide },
): OptionalSections | undefined {
  const matches = file.hunks
    .filter((hunk) => group.hunkIds.includes(hunk.id))
    .flatMap((hunk) =>
      hunk.lines
        .filter(
          (line) =>
            (location.side === DiffSide.left ? line.oldLine : line.newLine) === location.line,
        )
        .map((line) => ({ id: hunk.id, kind: line.kind })),
    )
  // Nearby canonical sections can share context. Prefer the section that owns the edit.
  const id = (matches.find((line) => line.kind !== LineKind.context) ?? matches[0])?.id
  if (!id) return undefined
  const sections = questionSections(group)
  if (sections.supporting.includes(id)) return 'supporting'
  if (sections.test.includes(id)) return 'test'
}

export function sectionLineCount(pull: PullRequest, group: ChangeGroup, hunkIds: string[]) {
  const { additions, deletions } = groupChangeTotals(pull, { ...group, hunkIds })
  return additions + deletions
}

export function questionReadCount(pull: PullRequest, questions: ChangeGroup[]) {
  const keyIds = new Set(questions.flatMap((group) => questionSections(group).key))
  const key = pull.files
    .flatMap((file) => file.hunks)
    .reduce(
      (sum, hunk) =>
        sum +
        (keyIds.has(hunk.id)
          ? hunk.lines.filter((line) => line.kind !== LineKind.context).length
          : 0),
      0,
    )
  const total = pull.files.reduce((sum, file) => sum + file.additions + file.deletions, 0)
  return `Read ${key.toLocaleString()} of ${total.toLocaleString()} lines`
}
