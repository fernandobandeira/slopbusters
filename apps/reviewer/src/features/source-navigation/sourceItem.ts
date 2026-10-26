import {
  parseDiffFromFile,
  type CodeViewItem,
  type FileContents,
  type FileDiffMetadata,
} from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { PullFileContent, RevisionFileContent } from '../../../shared/domain/fileContent'
import type { ChangedFile, PullRequest } from '../../../shared/domain/types'

/** The PR file a navigated revision belongs to, matched on either side's path. */
export function pullFileFor(pull: PullRequest, path: string): ChangedFile | undefined {
  return pull.files.find((file) => file.path === path || file.previousPath === path)
}

/**
 * Source opened while reviewing reads like the review: a PR file shows its whole diff, with
 * unchanged code collapsed and expandable. Anything else, or a revision that is not the one the
 * PR compares (such as a local checkout with other edits), is shown as plain source.
 */
export function sourceItem(
  revision: RevisionFileContent,
  side: 'old' | 'new',
  content?: PullFileContent,
): CodeViewItem<undefined> {
  const id = `${revision.sha}:${revision.path}`
  const same = content?.[side]
  if (!content || !same || same.content !== revision.content)
    return {
      id,
      type: 'file',
      file: { name: revision.path, contents: revision.content, cacheKey: id },
    }
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      fileContents(content.old, revision.path),
      fileContents(content.new, revision.path),
    ),
  }
}

/** An added or deleted file has no revision on one side; it diffs against empty contents. */
function fileContents(revision: RevisionFileContent | null, path: string): FileContents {
  return {
    name: revision?.path ?? path,
    contents: revision?.content ?? '',
    cacheKey: `${revision?.sha ?? 'none'}:${revision?.path ?? path}`,
  }
}

/**
 * The new-side line an old-side line sits beside, for revealing it in a collapsed diff. Unchanged
 * code shifts by the lines earlier hunks added or removed; a deleted line maps to its hunk.
 */
export function additionLine(diff: FileDiffMetadata, oldLine: number) {
  let shift = 0
  for (const hunk of diff.hunks) {
    if (oldLine < hunk.deletionStart) break
    if (oldLine < hunk.deletionStart + hunk.deletionCount) return hunk.additionStart
    shift += hunk.additionCount - hunk.deletionCount
  }
  return oldLine + shift
}

/** Center a line; in a diff, on the side the navigated revision belongs to. */
export function scrollToLine(
  viewer: Pick<CodeViewHandle<undefined, undefined>, 'scrollTo'> | null,
  target: { id: string; line: number; side?: 'old' | 'new' },
) {
  viewer?.scrollTo({
    type: 'line',
    id: target.id,
    lineNumber: target.line,
    ...(target.side ? { side: target.side === 'old' ? 'deletions' : 'additions' } : {}),
    align: 'center',
  })
}
