import {
  stackBrief,
  type BriefAnswer,
  type BriefFix,
  type PendingDecision,
  type StackBrief,
} from './stackBrief'
import { withLayerRevisions } from './stackBriefLayers'
import type { StackReviewSession } from './stackReview'
import {
  decisionSnapshot,
  matchesSnapshot,
  needsRecheck,
  observedLayers,
} from './stackDecisionSnapshot'
import type { BriefDecision } from './stackDecisions'
import type { DecisionRecord, ObservedLayer, StackRecord } from './stackReviewRecords'

export function buildStackBrief(
  session: StackReviewSession,
  {
    revisions = [],
    records = [],
    applied = [],
  }: {
    revisions?: readonly ObservedLayer[]
    records?: readonly StackRecord[]
    applied?: readonly string[]
  } = {},
) {
  if (session.status !== 'complete') return
  const brief = stackBrief(withLayerRevisions(session, revisions))
  if (brief) return { brief, projected: projectStackBrief(brief, session.id, records, applied) }
}

/** Records arrive newest session first. A reopen in the current session blocks carry-over. */
export function projectStackBrief(
  brief: StackBrief,
  sessionId: string,
  records: readonly StackRecord[],
  applied: readonly string[] = [],
): StackBrief {
  const local = records.filter((record) => record.sessionId === sessionId)
  const serious = new Set(brief.serious.map(({ id }) => id))
  const decisions = records.filter((record) => record.kind === 'decision')
  const answered: BriefAnswer[] = []
  const pending = new Map<string, PendingDecision>()
  for (const decision of brief.decisions) {
    const snapshot = decisionSnapshot(brief, decision)
    const own = local.find((record) => record.kind === 'decision' && record.itemId === decision.id)
    const record = own ?? carry(decisions, decision.id, brief, snapshot)
    const revision = own?.revision ?? 0
    if (!record?.answer) {
      pending.set(decision.id, {
        revision,
        stale: needsRecheck(snapshot, brief),
        serious: snapshot.entryIds.some((id) => serious.has(id)),
      })
    } else {
      answered.push(
        projectAnswer({
          decision,
          record: { ...record, answer: record.answer },
          brief,
          snapshot,
          revision,
        }),
      )
    }
  }
  return {
    ...brief,
    decisions: brief.decisions.filter(({ id }) => pending.has(id)),
    fixes: markApplied(projectFixes(brief, answered), applied),
    serious: brief.serious.map((claim) => {
      const record = local.find(
        ({ kind, itemId }) => kind === 'serious_claim' && itemId === claim.id,
      )
      return { ...claim, revision: record?.revision, disposition: record?.disposition ?? undefined }
    }),
    review: {
      answered,
      pending,
      history: decisions.filter(
        (record) =>
          record.answer &&
          !answered.some(
            ({ record: used }) =>
              used.sessionId === record.sessionId && used.itemId === record.itemId,
          ),
      ),
    },
  }
}

function markApplied(groups: StackBrief['fixes'], applied: readonly string[]): StackBrief['fixes'] {
  if (!applied.length) return groups
  const ids = new Set(applied)
  return groups.map(({ layer, items }) => ({
    layer,
    items: items.map((fix) => (ids.has(fix.id) ? { ...fix, applied: true } : fix)),
  }))
}

function carry(
  records: DecisionRecord[],
  id: string,
  brief: StackBrief,
  snapshot: DecisionRecord['snapshot'],
): DecisionRecord | undefined {
  const previous = records.find(
    (record) => record.itemId === id && matchesSnapshot(record.snapshot, snapshot),
  )
  return previous && !needsRecheck(snapshot, brief) && !needsRecheck(previous.snapshot, brief)
    ? previous
    : undefined
}

function projectAnswer({
  decision,
  record,
  brief,
  snapshot: current,
  revision,
}: {
  decision: BriefDecision
  record: BriefAnswer['record']
  brief: StackBrief
  snapshot: DecisionRecord['snapshot']
  revision: number
}): BriefAnswer {
  const { snapshot, answer } = record
  const option =
    answer.state === 'chosen'
      ? snapshot.options.find(({ id }) => id === answer.optionId)
      : undefined
  const matches = matchesSnapshot(snapshot, current)
  const moved = needsRecheck(snapshot, brief)
  return {
    decision,
    record,
    option,
    revision,
    recheck: moved || !matches,
    confirmableAt: matches && moved && revision ? observedLayers(snapshot, brief) : undefined,
    manual: Boolean(option?.change && !codeChange(option.change, brief)),
  }
}

function codeChange(change: NonNullable<BriefAnswer['option']>['change'], brief: StackBrief) {
  if (
    change?.plan.trim() &&
    !change.field &&
    !change.structure &&
    !change.unresolvedDestination &&
    brief.layers.some(({ number }) => number === change.layer)
  )
    return change
}

function projectFixes(brief: StackBrief, answers: BriefAnswer[]): StackBrief['fixes'] {
  const byLayer = new Map<number, BriefFix[]>()
  for (const item of answers) {
    const { record, decision, option } = item
    const change = codeChange(option?.change, brief)
    if (item.recheck || !option || !change) continue
    const fixes = byLayer.get(change.layer) ?? []
    fixes.push({
      id: `decision:${decision.id}:${encodeURIComponent(option.id)}`,
      title: decision.title,
      plan: change.plan,
      kind: decision.kind,
      triage: 'Chosen by the author.',
      alsoRaised: [],
      decision: {
        sessionId: record.sessionId,
        decisionId: decision.id,
        revision: record.revision,
        note: record.answer.note,
      },
    })
    byLayer.set(change.layer, fixes)
  }
  return brief.layers.flatMap((layer) => {
    const chosen = byLayer.get(layer.number)
    const original = brief.fixes.find((group) => group.layer.number === layer.number)
    return chosen
      ? [{ layer, items: [...chosen, ...(original?.items ?? [])] }]
      : original
        ? [original]
        : []
  })
}

export function bulkDefaults(brief: StackBrief, decisions: readonly BriefDecision[]) {
  return decisions.flatMap((decision) => {
    const status = brief.review?.pending.get(decision.id)
    const option = decision.options.find(({ recommended }) => recommended)
    if (!status || status.stale || status.serious || !option) return []
    return [
      {
        decisionId: decision.id,
        expectedRevision: status.revision,
        optionId: option.id,
        label: option.label,
      },
    ]
  })
}
