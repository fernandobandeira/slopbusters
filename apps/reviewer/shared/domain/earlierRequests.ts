import type { EarlierRequest, EarlierRequests } from './consistency'
import { leadSource } from './grounding'
import { chosenFixes } from './panelBrief'
import { gateItems } from './panelGate'
import type { PanelResult } from './panelSession'
import { stackBrief } from './stackBrief'
import type { StackReviewSession } from './stackReview'
import { triage } from './triage'

/** A PR's previous panel round: its result, when its panel ran, and a stack review built on it. */
export interface PreviousRound {
  result: PanelResult
  /** When the panel session that produced it started. */
  createdAt: string
  /** The complete stack review whose layer for this PR used that result, if any. */
  stack?: StackReviewSession
}

type Request = Omit<EarlierRequest, 'key'>

/**
 * What earlier rounds of the panel asked for on PR `pull`, newest first: the previous round's
 * fixes and decisions, from the stack brief when a stack review was built on it and from its own
 * gate otherwise, then the requests that round was given in turn. Past `budget` characters the
 * oldest are left out and counted. Nothing records which requests were made; grounding reads the
 * code for that.
 */
export function earlierRequests(
  pull: number,
  previous: PreviousRound | undefined,
  budget: number,
): EarlierRequests | undefined {
  if (!previous) return undefined
  const carried = previous.result.grounding?.earlier
  const all: Request[] = [
    ...(previous.stack
      ? fromStack(previous.stack, pull)
      : fromPanel(previous.result, day(previous.createdAt))),
    ...(carried?.requests ?? []).map(({ key: _key, ...request }) => request),
  ]
  const kept: Request[] = []
  let room = budget
  for (const request of all) {
    const size = JSON.stringify(request).length
    if (size > room) break
    kept.push(request)
    room -= size
  }
  return {
    requests: kept.map((request, index) => ({ key: `e${String(index + 1)}`, ...request })),
    left: all.length - kept.length + (carried?.left ?? 0),
  }
}

/**
 * Every fix and decision of the stack brief raised on this PR or placed on it: a fix moved here
 * or moved away, a derived fix on this layer, and a question about one of its entries.
 */
function fromStack(session: StackReviewSession, pull: number): Request[] {
  const brief = stackBrief(session)
  if (!brief) return []
  const round = day(session.createdAt)
  const reasons = new Map(session.input?.entries.map((entry) => [entry.id, entry.reason]))
  const raisedHere = (id: string) => id.startsWith(`#${String(pull)}/`)
  const fixes = brief.fixes.flatMap(({ layer, items }) =>
    items
      .filter((item) => layer.number === pull || raisedHere(item.id))
      .map((item) => ({
        round,
        entry: item.id,
        title: item.title,
        plan: item.plan ?? item.title,
        reason: reasons.get(item.id) ?? item.triage,
        asked: 'fix' as const,
      })),
  )
  const decisions = brief.decisions
    // A proposal to reshape the stack, named by its layer alone, asks for no change to code.
    .filter((item) => !/^#\d+$/.test(item.id) && (item.layer === pull || raisedHere(item.id)))
    .map((item) => ({
      round,
      entry: item.id,
      title: item.title,
      plan: item.recommendation ?? 'Leave the code as it is.',
      reason: item.question,
      asked: 'decision' as const,
    }))
  return [...fixes, ...decisions]
}

/** The previous round's own selection as fixes, and what its triage put to the author. */
function fromPanel(result: PanelResult, round: string): Request[] {
  const resolved = result.grounding?.resolved ?? []
  const candidates = result.grounding?.candidates ?? []
  const items = gateItems(resolved, result.gate, result.pull.number)
  const fixes = chosenFixes(items)
  const asked = items.filter(
    (item) => triage(item.entry).disposition === 'ask' && !fixes.includes(item),
  )
  const request = (item: (typeof items)[number], kind: Request['asked']): Request => ({
    round,
    entry: item.entry.id,
    title: leadSource(item.entry, candidates)?.finding.title ?? item.entry.id,
    plan: item.plan ?? item.entry.plan ?? item.entry.question ?? 'Leave the code as it is.',
    reason: item.entry.reason,
    asked: kind,
  })
  return [
    ...fixes.map((item) => request(item, 'fix')),
    ...asked.map((item) => request(item, 'decision')),
  ]
}

function day(timestamp: string): string {
  return timestamp.slice(0, 10)
}
