import type { LineKind } from './types'

export type SectionUpdate = 'new' | 'changed' | 'context-changed'
/** A display-only patch. Its line numbers come from the header, not from the current PR diff,
 * so reviewers can read it but cannot attach GitHub comments to it. */
export interface PatchHunk {
  header: string
  lines: { kind: LineKind; text: string }[]
}
export interface SectionChange {
  hunkId: string
  state: SectionUpdate
  /** What this section's new side changed between the reviewed revision and the current one. */
  interdiff?: PatchHunk
}
export interface RemovedSection {
  path: string
  line: number
  /** The reviewed edit reversed: lines it added are deletions, lines it removed are additions. */
  hunk: PatchHunk
}
export interface ReviewChanges {
  baselineHeadSha: string
  baselineBaseSha: string
  sections: SectionChange[]
  incompletePaths?: string[]
  removed: RemovedSection[]
}
