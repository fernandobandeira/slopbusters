import { parsePatchFiles, type CodeViewItem } from '@pierre/diffs'
import { LineKind, type ChangeGroup, type PullRequest } from '../../shared/domain/types'
import { mergeSelectedSections } from './selectedSections'
import type { PullFileContent } from '../../shared/domain/fileContent'

type PatchLine = { kind: LineKind; text: string }
interface PatchSource {
  id: string
  path: string
  previousPath?: string
  hunks: { header: string; lines: PatchLine[] }[]
  /** Identifies the immutable inputs; the rendered patch text is appended to it. */
  cacheKey: string
  context?: PullFileContent
}

export function diffItems(
  pr: PullRequest,
  group: ChangeGroup,
  contents?: ReadonlyMap<string, PullFileContent>,
): CodeViewItem<undefined>[] {
  return pr.files
    .filter((file) => group.fileIds.includes(file.id))
    .flatMap((file) => {
      const hunks = mergeSelectedSections(
        file.hunks.filter((hunk) => group.hunkIds.includes(hunk.id)),
      )
      if (!hunks.length) return []
      const context = contents?.get(file.id)
      // Cache by actual display patch as well as immutable sources: expanding context and
      // loading full revisions must invalidate a previously highlighted partial patch.
      return patchItems({
        id: file.id,
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        hunks,
        cacheKey: `${pr.id}:${group.id}:${file.id}:${context?.old?.sha ?? ''}:${context?.new?.sha ?? ''}`,
        ...(context ? { context } : {}),
      })
    })
}

/** Render hunks that are not part of the PR diff, such as edits since a previous review. */
export function patchItems(source: PatchSource): CodeViewItem<undefined>[] {
  const { id, path, previousPath, hunks, context } = source
  const patch = [
    `diff --git ${JSON.stringify(`a/${previousPath ?? path}`)} ${JSON.stringify(`b/${path}`)}`,
    `--- ${JSON.stringify(`a/${previousPath ?? path}`)}`,
    `+++ ${JSON.stringify(`b/${path}`)}`,
    ...hunks.flatMap((hunk) => [hunk.header, ...hunk.lines.map(patchLine)]),
    '',
  ].join('\n')
  return parsePatchFiles(patch, `${source.cacheKey}:${patch}`)
    .flatMap((parsed) => parsed.files)
    .map((parsed) => {
      // T3's partial-patch compaction keeps virtual rows dense and source line numbers intact.
      let split = 0
      let unified = 0
      const compact = parsed.hunks.map((hunk) => {
        const next = { ...hunk, splitLineStart: split, unifiedLineStart: unified }
        split += hunk.splitLineCount
        unified += hunk.unifiedLineCount
        return next
      })
      return {
        id,
        type: 'diff' as const,
        fileDiff: {
          ...parsed,
          name: path,
          ...(previousPath ? { prevName: previousPath } : {}),
          hunks: compact,
          splitLineCount: split,
          unifiedLineCount: unified,
          ...(context ? { syntaxContext: { old: context.old, new: context.new } } : {}),
        },
      }
    })
}

function patchLine(line: PatchLine): string {
  const prefix = line.kind === LineKind.added ? '+' : line.kind === LineKind.removed ? '-' : ' '
  return `${prefix}${line.text}`
}
