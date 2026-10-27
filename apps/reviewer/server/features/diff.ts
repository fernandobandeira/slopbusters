import { createHash } from 'node:crypto'
import { parsePatch } from 'diff'
import { splitChangeSections } from '../../shared/domain/changeSections'
import {
  LineKind,
  Priority,
  type ChangedFile,
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
  return { ...input, id, hunks: hunks.flatMap(splitChangeSections), coverage }
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

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
