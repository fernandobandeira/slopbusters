export interface RevisionFileContent {
  path: string
  /** Immutable commit SHA; old content is read at the PR diff's merge base. */
  sha: string
  content: string
  symbols: SourceSymbol[]
}

export interface PullFileContent {
  fileId: string
  old: RevisionFileContent | null
  new: RevisionFileContent | null
}

export interface SourceTree {
  sha: string
  /** Regular files only; symlinks and submodules are excluded. */
  paths: string[]
  warnings: string[]
}
import type { SourceSymbol } from './sourceSymbols'
