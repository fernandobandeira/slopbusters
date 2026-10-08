import { LineKind, type Hunk } from '../../shared/domain/types'

/** Adjacent selected sections can share context. Join that context for display,
 * while keeping their review identities and unselected edits separate. */
export function mergeSelectedSections(hunks: Hunk[]): Hunk[] {
  const groups: Hunk[][] = []
  for (const hunk of hunks) {
    const last = groups.at(-1)
    const previous = last?.at(-1)
    const shared =
      previous &&
      hunk.lines.some(
        (line) =>
          line.kind === LineKind.context && previous.lines.some((other) => other.id === line.id),
      )
    if (shared && last) last.push(hunk)
    else groups.push([hunk])
  }
  return groups.flatMap(mergeContext)
}

function mergeContext(hunks: Hunk[]): Hunk[] {
  const first = hunks[0]
  if (!first || hunks.length === 1) return hunks
  const lines = [
    ...new Map(hunks.flatMap((hunk) => hunk.lines).map((line) => [line.id, line])).values(),
  ]
  const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(first.header)
  if (!range) return hunks
  const oldCount = lines.filter((line) => line.kind !== LineKind.added).length
  const newCount = lines.filter((line) => line.kind !== LineKind.removed).length
  return [{ ...first, lines, header: `@@ -${range[1]},${oldCount} +${range[2]},${newCount} @@` }]
}
