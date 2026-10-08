export type SectionUpdate = 'new' | 'changed' | 'context-changed'
export interface RemovedSection {
  path: string
  line: number
  code: string
}
export interface ReviewChanges {
  baselineHeadSha: string
  baselineBaseSha: string
  sections: { hunkId: string; state: SectionUpdate }[]
  incompletePaths?: string[]
  removed: RemovedSection[]
}
export const sectionUpdateLabels: Record<SectionUpdate, string> = {
  new: 'New since review',
  changed: 'Changed since review',
  'context-changed': 'Context changed',
}
