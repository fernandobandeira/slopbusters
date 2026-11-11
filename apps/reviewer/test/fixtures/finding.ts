import { DiffSide, LineKind } from '../../shared/domain/types'
import { fixturePull } from './pull'
import { required } from './required'

/** A finding on an added line of the fixture PR, where a review would anchor it. */
export function fixtureFinding() {
  const file = required(fixturePull().files[1])
  const hunk = required(
    file.hunks.find((hunk) => hunk.lines.some((line) => line.text.includes('auditEntry'))),
  )
  const line = required(
    hunk.lines.find((line) => line.kind === LineKind.added && line.text.includes('auditEntry')),
  )
  return {
    id: 'reuse-audit-helper',
    severity: 'should-fix' as const,
    title: 'Reuse the audit helper',
    body: 'This repeats the audit entry construction in src/lib/audit.ts.',
    suggestion: 'Call auditProjectUpdate(viewer, project) from src/lib/audit.ts instead.',
    path: file.path,
    hunkId: hunk.id,
    line: required(line.newLine),
    side: DiffSide.right,
  }
}
