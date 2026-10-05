import type { DiffSide } from './types'

export interface NavigationRequest {
  side: DiffSide
  path: string
  /** One-based line and UTF-16 column in the exact source revision. */
  line: number
  column: number
  kind: 'definition' | 'references' | 'implementation'
}

export interface NavigationTarget {
  path: string
  line: number
  column: number
  endLine: number
  /** Exclusive end column. */
  endColumn: number
  name: string
}

export interface NavigationResult {
  language: string
  mode: 'semantic' | 'text'
  targets: NavigationTarget[]
  warnings: string[]
  source?: { sha: string; kind: 'local' | 'snapshot' }
}
