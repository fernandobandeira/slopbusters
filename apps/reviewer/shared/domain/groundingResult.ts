import {
  entryRevision,
  groundingVerdictLabels,
  keyOrder,
  leadSource,
  listRevision,
  type GroundedEntry,
  type GroundingRole,
  type GroundingState,
  type GroundingTurn,
  type ResolvedEntry,
} from './grounding'
import {
  judgeAdviceSchema,
  setAsideSchema,
  type JudgeAdvice,
  type JudgedFinding,
  type SetAside,
} from './panel'
import type { OrganizationPreferences } from './preferences'

/**
 * Save a valid turn on the state: the new list, this role's position on it, and the turn in the
 * history. It changed when the list's substance differs from the one it received; it approves
 * only after the first turn, unchanged and without objections.
 */
export function recordTurn(
  state: GroundingState,
  turn: { role: GroundingRole; model: OrganizationPreferences; reply: GroundingTurn },
): { changed: boolean; approved: boolean } {
  const { role, model, reply } = turn
  const changed =
    state.turns.length === 0 || listRevision(reply.entries) !== listRevision(state.entries)
  const approved =
    state.turns.length > 0 && !changed && reply.approved && reply.objections.length === 0
  state.entries = reply.entries
  state.positions[role] = { entries: reply.entries, objections: reply.objections }
  state.turns.push({
    role,
    model,
    summary: reply.summary,
    changed,
    approved,
    objections: reply.objections,
  })
  return { changed, approved }
}

/**
 * Each entry of the last valid list with its resolution. When both approved the list, it is
 * agreed; otherwise an entry is agreed only when the other model holds the same revision with no
 * objection, disputed when it holds a different verdict or grouping or objects, and unverified
 * when it never assessed this version. An entry without a verdict is always unverified.
 */
export function resolveEntries(
  state: GroundingState,
  raisedBy: (key: string) => string | undefined,
): ResolvedEntry[] {
  const last = state.turns.at(-1)?.role
  const other: GroundingRole | undefined =
    last === 'primary' ? 'secondary' : last === 'secondary' ? 'primary' : undefined
  return state.entries.map((entry) => {
    const seats = [...new Set(entry.sources.flatMap((key) => raisedBy(key) ?? []))]
    return { ...entry, raisedBy: seats, ...resolution(state, entry, { last, other }) }
  })
}

function resolution(
  state: GroundingState,
  entry: GroundedEntry,
  { last, other }: { last?: GroundingRole; other?: GroundingRole },
): Pick<ResolvedEntry, 'resolution' | 'other'> {
  if (!entry.verdict) return { resolution: 'unverified' }
  if (state.outcome === 'agreed') return { resolution: 'agreed' }
  const objectionsOf = (role: GroundingRole | undefined, id: string) =>
    (role ? (state.positions[role]?.objections ?? []) : [])
      .filter((item) => item.entry === id)
      .map((item) => item.objection)
  const held = other ? (state.positions[other]?.entries ?? []) : []
  const overlapping = held.filter((item) => item.sources.some((key) => entry.sources.includes(key)))
  if (!other || !overlapping.length) return { resolution: 'unverified' }
  const objections = [
    ...objectionsOf(last, entry.id),
    ...overlapping.flatMap((item) => objectionsOf(other, item.id)),
  ]
  const same = overlapping.length === 1 && !objections.length ? overlapping[0] : undefined
  if (same && entryRevision(same) === entryRevision(entry)) return { resolution: 'agreed' }
  const reworded = same && sameGrouping(same, entry) && same.verdict === entry.verdict
  return {
    resolution: reworded ? 'unverified' : 'disputed',
    other: { role: other, entries: overlapping, objections },
  }
}

function sameGrouping(a: GroundedEntry, b: GroundedEntry) {
  return [...a.sources].sort().join() === [...b.sources].sort().join()
}

/** As many limitations as the review schema holds. */
const MAX_LIMITATIONS = 16

const rejections = new Set(['notTrue', 'overEngineering', 'tasteSkip'])

/** Fix first, then questions, then what is still open, then disputed rejections. */
function displayGroup(entry: ResolvedEntry): number {
  if (entry.verdict === 'legit') return entry.resolution === 'agreed' ? 0 : 2
  if (entry.verdict === 'authorsCall') return 1
  if (!entry.verdict) return 3
  return 4
}

/**
 * The grounded round as the review the panel shows: entries to act on or still open become
 * findings, led by their highest-ranked source; rejections both models agree on are set aside
 * with their reason. Deferred candidates stay on the grounding state and count in limitations.
 */
export function groundedAdvice(
  state: GroundingState,
  { summary, limitations }: { summary: string; limitations: string[] },
): JudgeAdvice {
  const resolved = state.resolved ?? []
  const settled = (entry: ResolvedEntry) =>
    entry.resolution === 'agreed' && entry.verdict !== undefined && rejections.has(entry.verdict)
  const order = (entry: ResolvedEntry) =>
    Math.min(...entry.sources.map(keyOrder)) + displayGroup(entry) * 1000
  const findings = resolved
    .filter((entry) => !settled(entry))
    .sort((a, b) => order(a) - order(b))
    .flatMap((entry) => asFinding(state, entry))
  const setAside = resolved.filter(settled).flatMap((entry) => asSetAside(state, entry))
  const disputed = resolved.filter((entry) => entry.resolution === 'disputed')
  const open = findings.length > 0
  return judgeAdviceSchema.parse({
    verdict: open ? 'changes' : limitations.length ? 'uncertain' : 'clean',
    summary: clip(
      open || !limitations.length ? summary : `No further accepted fixes in this round. ${summary}`,
      judgeAdviceSchema.shape.summary.maxLength,
    ),
    findings,
    setAside,
    good: [],
    limitations: limitations.slice(0, MAX_LIMITATIONS),
    disagreements: disputed.slice(0, 8).map((entry) => disagreement(state, entry)),
  })
}

function asFinding(state: GroundingState, entry: ResolvedEntry): JudgedFinding[] {
  const lead = leadSource(entry, state.candidates)
  if (!lead) return []
  return [{ ...lead.finding, id: entry.id, raisedBy: entry.raisedBy }]
}

function asSetAside(state: GroundingState, entry: ResolvedEntry): SetAside[] {
  const lead = leadSource(entry, state.candidates)
  if (!lead || !entry.verdict) return []
  const anchor = lead.finding.anchor
  const location = anchor.kind === 'stack' ? anchor.location : anchor
  return [
    setAsideSchema.parse({
      title: lead.finding.title,
      body: clip(lead.finding.body, setAsideSchema.shape.body.maxLength),
      ...(location.kind === 'description' ? {} : { path: location.path, line: location.line }),
      raisedBy: entry.raisedBy,
      reason: clip(
        `${groundingVerdictLabels[entry.verdict]}: ${entry.reason}`,
        setAsideSchema.shape.reason.maxLength,
      ),
    }),
  ]
}

function disagreement(state: GroundingState, entry: ResolvedEntry): string {
  const title = leadSource(entry, state.candidates)?.finding.title ?? entry.id
  const held = entry.other?.entries
    .map((item) => (item.verdict ? groundingVerdictLabels[item.verdict] : 'no verdict'))
    .join(', ')
  const verdict = entry.verdict ? groundingVerdictLabels[entry.verdict] : 'no verdict'
  const objection = entry.other?.objections[0]
  return clip(
    `${title}: ${verdict} on the last turn; the other model held ${held || 'nothing'}${objection ? ` and objected: ${objection}` : '.'}`,
    1500,
  )
}

function clip(text: string, length: number | null) {
  return length !== null && text.length > length ? `${text.slice(0, length - 1)}…` : text
}
