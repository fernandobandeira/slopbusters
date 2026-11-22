import type { BriefDecision } from '../../shared/domain/stackDecisions'
import type { StackBrief } from '../../shared/domain/stackBrief'
import { decisionSnapshot } from '../../shared/domain/stackDecisionSnapshot'
import type { DecisionRecord, StackAnswer } from '../../shared/domain/stackReviewRecords'
import { stackRepository } from './stackReview'

export function stackDecisionRecord(
  brief: StackBrief,
  decision: BriefDecision,
  answer: StackAnswer | null,
  revision = 1,
): DecisionRecord {
  return {
    sessionId: 'stack-1',
    itemId: decision.id,
    kind: 'decision',
    repository: stackRepository,
    sourcePr: decision.layer,
    targetPr: null,
    revision,
    updatedAt: '2026-11-13T10:00:00.000Z',
    snapshot: decisionSnapshot(brief, decision),
    answer,
    disposition: null,
  }
}
