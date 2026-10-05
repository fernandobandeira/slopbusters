import {
  cleanLastNewline,
  renderDiffWithHighlighter,
  type CodeToHastOptions,
  type DiffsHighlighter,
  type FileDiffMetadata,
  type RenderDiffOptions,
} from '@pierre/diffs'
import type { PullFileContent } from '../../../../shared/domain/fileContent'

export interface ContextualFileDiff extends FileDiffMetadata {
  /** Exact immutable revisions, used for lexical state only. Never expanded into displayed hunks. */
  syntaxContext?: Pick<PullFileContent, 'old' | 'new'>
}

interface HunkSyntaxContext {
  code: string
  prefix?: string
}

function hunkContexts(diff: ContextualFileDiff): HunkSyntaxContext[] {
  const contexts: HunkSyntaxContext[] = []
  for (const hunk of diff.hunks) {
    for (const side of ['old', 'new'] as const) {
      const old = side === 'old'
      const count = old ? hunk.deletionCount : hunk.additionCount
      if (!count) continue
      const index = old ? hunk.deletionLineIndex : hunk.additionLineIndex
      const patchLines = old ? diff.deletionLines : diff.additionLines
      const code = cleanLastNewline(patchLines.slice(index, index + count).join(''))
      const source = diff.syntaxContext?.[side]?.content
      const start = Math.max(0, (old ? hunk.deletionStart : hunk.additionStart) - 1)
      // Verify the immutable source against this exact display hunk. A stale or incomplete
      // source must never lend lexical state to unrelated code.
      const lines = source?.match(/[^\n]*\n|[^\n]+$/g) ?? []
      const matches =
        source !== undefined &&
        cleanLastNewline(lines.slice(start, start + count).join('')) === code
      contexts.push({ code, ...(matches ? { prefix: lines.slice(0, start).join('') } : {}) })
    }
  }
  return contexts
}

/** Keep Pierre's line coordinates and word decorations while restoring Shiki's grammar state. */
export function renderContextualDiff(
  diff: ContextualFileDiff,
  highlighter: DiffsHighlighter,
  options: RenderDiffOptions,
) {
  if (!diff.isPartial || !diff.syntaxContext)
    return renderDiffWithHighlighter(diff, highlighter, options)
  const contexts = hunkContexts(diff)
  let index = 0
  const contextual = Object.create(highlighter) as DiffsHighlighter
  contextual.codeToHast = (code: string, settings: CodeToHastOptions) => {
    const context = contexts[index++]
    return highlighter.codeToHast(code, {
      ...settings,
      ...(context?.code === code && context.prefix !== undefined
        ? { grammarContextCode: context.prefix }
        : {}),
    })
  }
  return renderDiffWithHighlighter(diff, contextual, options)
}
