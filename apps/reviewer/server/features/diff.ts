import { createHash } from 'node:crypto'
import { parsePatch } from 'diff'
import {
  LineKind,
  Priority,
  TransferKind,
  type ChangedFile,
  type CodeTransfer,
  type DiffLine,
  type ChangeGroup,
} from '../../shared/domain/types'

export interface FileInput {
  path: string
  previousPath?: string
  status: string
  additions: number
  deletions: number
  patch?: string
  oldContent?: string
}

export function parseFile(input: FileInput): ChangedFile {
  const id = digest(input.path)
  let parsed: ReturnType<typeof parsePatch>[number] | undefined
  try {
    parsed = input.patch
      ? parsePatch(
          `--- a/${input.previousPath ?? input.path}\n+++ b/${input.path}\n${input.patch}\n`,
        )[0]
      : undefined
  } catch {
    // An incomplete API patch stays visible as unavailable without breaking the entire PR.
    parsed = undefined
  }
  const hunks = (parsed?.hunks ?? []).map((hunk, index) => {
    const hunkId = `${id}-${index}`
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    const lines: DiffLine[] = []
    for (const raw of hunk.lines) {
      if (raw.startsWith('\\')) continue
      let kind = LineKind.context
      if (raw.startsWith('+')) kind = LineKind.added
      else if (raw.startsWith('-')) kind = LineKind.removed
      lines.push({
        id: `${hunkId}-${lines.length}`,
        kind,
        text: raw.slice(1),
        oldLine: kind === LineKind.added ? null : oldLine++,
        newLine: kind === LineKind.removed ? null : newLine++,
      })
    }
    return {
      id: hunkId,
      fileId: id,
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      lines,
    }
  })
  const added = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === LineKind.added).length
  const removed = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === LineKind.removed).length
  let coverage: ChangedFile['coverage'] = 'complete'
  if (!parsed) coverage = 'unavailable'
  else if (added !== input.additions || removed !== input.deletions) coverage = 'partial'
  return { ...input, id, hunks, coverage }
}

export function fileGroups(files: ChangedFile[]): ChangeGroup[] {
  return files.map((file) => ({
    id: `file-${file.id}`,
    title: file.path,
    priority: Priority.normal,
    reason: 'File order. Choose Organize changes to group related edits with your coding provider.',
    hunkIds: file.hunks.map((hunk) => hunk.id),
    fileIds: [file.id],
  }))
}

/** Matches unchanged text blocks. Similar-looking or edited blocks remain ordinary diffs. */
export function detectTransfers(files: ChangedFile[]): CodeTransfer[] {
  const removed = files.flatMap((file) => changedRuns(file, LineKind.removed))
  const added = files.flatMap((file) => changedRuns(file, LineKind.added))
  const transfers: CodeTransfer[] = []
  const claimed = new Set<string>()
  for (const destination of added) {
    for (let offset = 0; offset < destination.lines.length; offset++) {
      const first = destination.lines[offset]
      if (!first || claimed.has(first.id)) continue
      let best:
        | { path: string; fromLine: number; lines: DiffLine[]; count: number; kind: TransferKind }
        | undefined
      for (const source of removed) {
        for (let start = 0; start < source.lines.length; start++) {
          let count = 0
          while (
            sameText(source.lines[start + count], destination.lines[offset + count]) &&
            !claimed.has(source.lines[start + count]?.id ?? '') &&
            !claimed.has(destination.lines[offset + count]?.id ?? '')
          )
            count++
          const sourceLine = source.lines[start]
          if (count >= 4 && sourceLine?.oldLine != null && (!best || count > best.count)) {
            best = {
              path: source.path,
              fromLine: sourceLine.oldLine,
              lines: source.lines.slice(start, start + count),
              count,
              kind: TransferKind.moved,
            }
          }
        }
      }
      // Copies can originate in unchanged code of a changed file, including context outside its hunks.
      if (!best)
        for (const file of files) {
          if (!file.oldContent) continue
          const sourceLines = file.oldContent.split('\n')
          for (let start = 0; start < sourceLines.length; start++) {
            let count = 0
            while (
              destination.lines[offset + count] &&
              sourceLines[start + count] === destination.lines[offset + count]?.text &&
              !claimed.has(destination.lines[offset + count]?.id ?? '')
            )
              count++
            if (count < 4 || (best && count <= best.count)) continue
            const end = start + count
            const sourceDeleted = removed.some(
              (run) =>
                run.path === file.path &&
                run.lines.some(
                  (line) =>
                    line.oldLine != null && line.oldLine >= start + 1 && line.oldLine <= end,
                ),
            )
            const sameLocation = file.path === destination.path && first.newLine === start + 1
            if (!sourceDeleted && !sameLocation)
              best = {
                path: file.path,
                fromLine: start + 1,
                lines: [],
                count,
                kind: TransferKind.copied,
              }
          }
        }
      if (!best || first.newLine == null) continue
      const matched = destination.lines.slice(offset, offset + best.count)
      const meaningful = matched.filter((line) => line.text.trim().length > 2)
      if (meaningful.length < 3 || matched.map((line) => line.text).join('').length < 80) continue
      const sourceIds = best.lines.map((line) => line.id)
      const destinationIds = matched.map((line) => line.id)
      for (const lineId of [...sourceIds, ...destinationIds]) claimed.add(lineId)
      transfers.push({
        id: digest(`${best.path}:${best.fromLine}:${destination.path}:${first.newLine}`),
        kind: best.kind,
        fromPath: best.path,
        fromLine: best.fromLine,
        toPath: destination.path,
        toLine: first.newLine,
        lineCount: best.count,
        sourceLineIds: sourceIds,
        destinationLineIds: destinationIds,
        text: matched.map((line) => line.text).join('\n'),
      })
      offset += best.count - 1
    }
  }
  return transfers
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function sameText(left: DiffLine | undefined, right: DiffLine | undefined): boolean {
  return left != null && right != null && left.text === right.text
}

function changedRuns(file: ChangedFile, kind: LineKind) {
  const runs: { path: string; lines: DiffLine[] }[] = []
  for (const hunk of file.hunks) {
    let lines: DiffLine[] = []
    for (const line of hunk.lines) {
      if (line.kind === kind) lines.push(line)
      else if (lines.length) {
        runs.push({ path: file.path, lines })
        lines = []
      }
    }
    if (lines.length) runs.push({ path: file.path, lines })
  }
  return runs
}
