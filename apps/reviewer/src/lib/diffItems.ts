import {
  hydratePartialDiff,
  parsePatchFiles,
  type CodeViewItem,
  type FileDiffMetadata,
} from '@pierre/diffs'
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
      const fileDiff = {
        ...parsed,
        name: path,
        ...(previousPath ? { prevName: previousPath } : {}),
        hunks: compact,
        splitLineCount: split,
        unifiedLineCount: unified,
        ...(context ? { syntaxContext: { old: context.old, new: context.new } } : {}),
      }
      return {
        id,
        type: 'diff' as const,
        fileDiff: (context && expandableDiff(fileDiff, context)) ?? fileDiff,
      }
    })
}

/**
 * Give Pierre both full revisions so "N unmodified lines" expands in place. Only when every
 * collapsed gap is really unchanged: a group hides other groups' edits, and those must never
 * show up as context. Anything that disagrees with the displayed patch stays a partial diff.
 */
function expandableDiff<T extends FileDiffMetadata>(diff: T, context: PullFileContent) {
  if (!context.old || !context.new) return undefined
  if (diff.type !== 'change' && diff.type !== 'rename-changed') return undefined
  const full = hydratePartialDiff('clone', diff, {
    oldFile: { name: diff.prevName ?? diff.name, contents: context.old.content },
    newFile: { name: diff.name, contents: context.new.content },
  }) as T
  return showsSamePatch(diff, full) && gapsUnchanged(full) ? full : undefined
}

function showsSamePatch(partial: FileDiffMetadata, full: FileDiffMetadata) {
  return partial.hunks.every((hunk, index) => {
    const hydrated = full.hunks[index]
    if (!hydrated) return false
    const slice = (lines: string[], at: number, count: number) => lines.slice(at, at + count)
    return (
      sameLines(
        slice(partial.deletionLines, hunk.deletionLineIndex, hunk.deletionCount),
        slice(full.deletionLines, hydrated.deletionLineIndex, hunk.deletionCount),
      ) &&
      sameLines(
        slice(partial.additionLines, hunk.additionLineIndex, hunk.additionCount),
        slice(full.additionLines, hydrated.additionLineIndex, hunk.additionCount),
      )
    )
  })
}

function gapsUnchanged(full: FileDiffMetadata) {
  let oldEnd = 0
  let newEnd = 0
  for (const hunk of full.hunks) {
    // An empty side's start names the line before the edit, so the gap runs through it.
    const oldStart = hunk.deletionCount ? hunk.deletionStart - 1 : hunk.deletionStart
    const newStart = hunk.additionCount ? hunk.additionStart - 1 : hunk.additionStart
    if (
      !sameLines(
        full.deletionLines.slice(oldEnd, oldStart),
        full.additionLines.slice(newEnd, newStart),
      )
    )
      return false
    oldEnd = oldStart + hunk.deletionCount
    newEnd = newStart + hunk.additionCount
  }
  return sameLines(full.deletionLines.slice(oldEnd), full.additionLines.slice(newEnd))
}

function sameLines(left: string[], right: string[]) {
  const text = (line: string) => line.replace(/\r?\n$/, '')
  return (
    left.length === right.length &&
    left.every((line, index) => text(line) === text(right[index] ?? ''))
  )
}

function patchLine(line: PatchLine): string {
  const prefix = line.kind === LineKind.added ? '+' : line.kind === LineKind.removed ? '-' : ' '
  return `${prefix}${line.text}`
}
