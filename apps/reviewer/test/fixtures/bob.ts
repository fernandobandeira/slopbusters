import type { BobAdvice, BobFinding } from '../../shared/domain/bob'
import { DiffSide, LineKind } from '../../shared/domain/types'
import { fixturePull } from './pull'

export function fixtureBobFinding(): BobFinding {
  const file = required(fixturePull().files[1])
  const hunk = required(
    file.hunks.find((hunk) => hunk.lines.some((line) => line.text.includes('auditEntry'))),
  )
  const line = required(
    hunk.lines.find((line) => line.kind === LineKind.added && line.text.includes('auditEntry')),
  )
  return {
    id: 'reuse-audit-helper',
    severity: 'should-fix',
    title: 'Reuse the audit helper',
    body: 'This repeats the audit entry construction in src/lib/audit.ts.',
    suggestion: 'Call auditProjectUpdate(viewer, project) from src/lib/audit.ts instead.',
    path: file.path,
    hunkId: hunk.id,
    line: required(line.newLine),
    side: DiffSide.right,
  }
}
export function fixtureBobAdvice(): BobAdvice {
  return {
    verdict: 'changes',
    summary: 'The permission rule reads clearly. Reuse the existing audit helper.',
    findings: [fixtureBobFinding()],
    good: ['canEditProject names the permission rule.'],
    limitations: [],
    disagreements: [],
  }
}

export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing expected test value.')
  return value
}
