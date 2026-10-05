import type { PullFileContent } from '../../../../shared/domain/fileContent'
import {
  LineKind,
  type ChangedFile,
  type Hunk,
  type PullRequest,
} from '../../../../shared/domain/types'

export const CONTEXT_STEP = 20
export const MAX_CONTEXT = 200

function range(hunk: Hunk) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(hunk.header)
  return match
    ? {
        old: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        next: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        suffix: match[5],
      }
    : null
}

function sourceLines(content: string) {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

/** Enrich only the display copy. Never cross another canonical changed section. */
export function expandDisplayHunk(
  file: ChangedFile,
  hunk: Hunk,
  content: PullFileContent,
  requested: number,
): Hunk {
  const current = range(hunk)
  if (!current || !content.old || !content.new || file.coverage !== 'complete') return hunk
  const old = sourceLines(content.old.content)
  const next = sourceLines(content.new.content)
  const index = file.hunks.findIndex((candidate) => candidate.id === hunk.id)
  const previous = index > 0 ? range(file.hunks[index - 1]!) : null
  const following = index < file.hunks.length - 1 ? range(file.hunks[index + 1]!) : null
  const limit = Math.min(MAX_CONTEXT, Math.max(0, Math.floor(requested)))
  // Split gaps between neighbors so expanding both sections never duplicates a line.
  const beforeLimit = previous
    ? Math.floor(
        Math.min(
          current.old - previous.old - previous.oldCount,
          current.next - previous.next - previous.newCount,
        ) / 2,
      )
    : Infinity
  const afterLimit = following
    ? Math.ceil(
        Math.min(
          following.old - current.old - current.oldCount,
          following.next - current.next - current.newCount,
        ) / 2,
      )
    : Infinity
  const before = []
  const after = []
  for (let offset = 1; offset <= Math.min(limit, beforeLimit); offset++) {
    const oldLine = current.old - offset
    const newLine = current.next - offset
    if (
      oldLine < 1 ||
      newLine < 1 ||
      old[oldLine - 1] !== next[newLine - 1] ||
      old[oldLine - 1] === undefined
    )
      break
    before.unshift({
      id: `context:${hunk.id}:${oldLine}:${newLine}`,
      kind: LineKind.context,
      text: old[oldLine - 1]!,
      oldLine,
      newLine,
    })
  }
  for (let offset = 0; offset < Math.min(limit, afterLimit); offset++) {
    const oldLine = current.old + current.oldCount + offset
    const newLine = current.next + current.newCount + offset
    if (old[oldLine - 1] !== next[newLine - 1] || old[oldLine - 1] === undefined) break
    after.push({
      id: `context:${hunk.id}:${oldLine}:${newLine}`,
      kind: LineKind.context,
      text: old[oldLine - 1]!,
      oldLine,
      newLine,
    })
  }
  if (!before.length && !after.length) return hunk
  return {
    ...hunk,
    header: `@@ -${current.old - before.length},${current.oldCount + before.length + after.length} +${current.next - before.length},${current.newCount + before.length + after.length} @@${current.suffix}`,
    lines: [...before, ...hunk.lines, ...after],
  }
}

export function displayPullWithContext(
  pull: PullRequest,
  contents: ReadonlyMap<string, PullFileContent>,
  contextLines: ReadonlyMap<string, number>,
): PullRequest {
  return {
    ...pull,
    files: pull.files.map((file) => {
      const content = contents.get(file.id)
      const count = contextLines.get(file.id) ?? 0
      return content && count
        ? {
            ...file,
            hunks: file.hunks.map((hunk) => expandDisplayHunk(file, hunk, content, count)),
          }
        : file
    }),
  }
}
