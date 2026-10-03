import type { DiffSide } from './types'

export const navigationKinds = ['definition', 'implementation', 'references', 'usages'] as const
export type NavigationKind = (typeof navigationKinds)[number]
export const navigationLabels: Record<NavigationKind, string> = {
  definition: 'Go to definition',
  implementation: 'Find implementations',
  references: 'Find references',
  usages: 'Find usages',
}

export interface NavigationRequest {
  side: DiffSide
  path: string
  /** One-based line and UTF-16 column in the exact source revision. */
  line: number
  column: number
  kind: NavigationKind
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
}
