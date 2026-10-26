import { parseDiffFromFile, type CodeViewItem, type FileContents } from '@pierre/diffs'
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
