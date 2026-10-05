import { parsePatchFiles, type CodeViewItem } from '@pierre/diffs'
import { LineKind, type ChangeGroup, type PullRequest } from '../../shared/domain/types'
import type { PullFileContent } from '../../shared/domain/fileContent'

export function diffItems(
  pr: PullRequest,
  group: ChangeGroup,
  contents?: ReadonlyMap<string, PullFileContent>,
): CodeViewItem<undefined>[] {
  return pr.files
    .filter((file) => group.fileIds.includes(file.id))
    .flatMap((file) => {
      const hunks = file.hunks.filter((hunk) => group.hunkIds.includes(hunk.id))
      if (!hunks.length) return []
      const patch = [
        `diff --git ${JSON.stringify(`a/${file.previousPath ?? file.path}`)} ${JSON.stringify(`b/${file.path}`)}`,
        `--- ${JSON.stringify(`a/${file.previousPath ?? file.path}`)}`,
        `+++ ${JSON.stringify(`b/${file.path}`)}`,
        ...hunks.flatMap((hunk) => [
          hunk.header,
          ...hunk.lines.map(
            (line) =>
              `${line.kind === LineKind.added ? '+' : line.kind === LineKind.removed ? '-' : ' '}${line.text}`,
          ),
        ]),
        '',
      ].join('\n')
      const context = contents?.get(file.id)
      // Cache by actual display patch as well as immutable sources: expanding context and
      // loading full revisions must invalidate a previously highlighted partial patch.
      const cacheKey = `${pr.id}:${group.id}:${file.id}:${patch}:${context?.old?.sha ?? ''}:${context?.new?.sha ?? ''}`
      return parsePatchFiles(patch, cacheKey)
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
            id: file.id,
            type: 'diff' as const,
            fileDiff: {
              ...parsed,
              name: file.path,
              ...(file.previousPath ? { prevName: file.previousPath } : {}),
              hunks: compact,
              splitLineCount: split,
              unifiedLineCount: unified,
              ...(context ? { syntaxContext: { old: context.old, new: context.new } } : {}),
            },
          }
        })
    })
}
