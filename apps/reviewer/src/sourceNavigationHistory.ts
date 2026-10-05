import type { RevisionFileContent } from '../shared/fileContent'
import type { NavigationTarget } from '../shared/navigation'
import type { CodeSymbol } from './codeSymbols'

export interface SourceVisit {
  file: RevisionFileContent
  target: NavigationTarget
}
export interface SourceHistory {
  visits: SourceVisit[]
  index: number
}
export const emptySourceHistory: SourceHistory = { visits: [], index: -1 }

export function visitSource(history: SourceHistory, visit: SourceVisit): SourceHistory {
  const visits = [...history.visits.slice(0, history.index + 1), visit]
  return { visits, index: visits.length - 1 }
}

export function isCurrentDefinition(
  path: string,
  selection: CodeSymbol,
  target: NavigationTarget,
): boolean {
  return (
    target.path === path &&
    selection.line >= target.line &&
    selection.line <= target.endLine &&
    (selection.line !== target.line || selection.column >= target.column) &&
    (selection.line !== target.endLine || selection.column < target.endColumn)
  )
}

export function navigationOutcome(
  kind: 'definition' | 'references' | 'implementation',
  count: number,
): string {
  if (count) return ''
  return kind === 'references'
    ? 'No references found in the available source.'
    : kind === 'implementation'
      ? 'No implementations found in the available source.'
      : 'No definition found. Dependencies, generated code, or project configuration may be missing from this PR checkout. Try workspace setup, or open the symbol in your configured IDE.'
}
