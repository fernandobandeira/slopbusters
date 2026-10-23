import { z } from 'zod'
import type { ResolvedEntry } from './grounding'
import { stableId } from './findings'

const MAX_GATE_TEXT = 2000

/**
 * What the author decided about one grounded entry. The models' verdict stays on the entry; this
 * records only the author's selection, answer, choice and any plan they or a planning pass wrote.
 */
export const gateActionSchema = z
  .object({
    entry: z.string().min(1).max(40),
    selected: z.boolean(),
    /** The author's answer to an author's-call question. */
    answer: z.string().trim().max(MAX_GATE_TEXT).optional(),
    /** On a disputed entry, which model's position the author takes. */
    choice: z.enum(['list', 'other']).optional(),
    /** A plan that replaces the models' plan, and who wrote it. */
    plan: z.string().trim().min(1).max(MAX_GATE_TEXT).optional(),
    planBy: z.enum(['author', 'planner']).optional(),
    /** The answer a planning pass wrote its plan from; a changed answer invalidates the plan. */
    plannedFrom: z.string().max(MAX_GATE_TEXT).optional(),
  })
  .strict()
export type GateAction = z.infer<typeof gateActionSchema>

export const gateSchema = z.object({ actions: z.array(gateActionSchema).max(40) }).strict()
export type Gate = z.infer<typeof gateSchema>

/** Where a ready fix goes: the fix thread, another layer's round, or a title/description draft. */
export type GateRoute =
  | { kind: 'fix' }
  | { kind: 'layer'; pull: number }
  | { kind: 'metadata'; pull: number; field: 'title' | 'description' }

export interface GateItem {
  entry: ResolvedEntry
  action: GateAction
  /** The plan a fix would carry out, when there is one. */
  plan?: string
  route?: GateRoute
  /** Why a selected entry cannot be sent yet; it blocks only this entry. */
  problem?: string
}

/** The gate before the author has touched it: entries both models agree are worth fixing. */
export function initialGate(entries: readonly ResolvedEntry[]): Gate {
  return {
    actions: entries.map((entry) => ({
      entry: entry.id,
      selected: entry.verdict === 'legit' && entry.resolution === 'agreed',
    })),
  }
}

/** Each entry with the author's action on it, its plan and route, and what blocks it. */
export function gateItems(
  entries: readonly ResolvedEntry[],
  gate: Gate | undefined,
  pull: number,
): GateItem[] {
  const actions = new Map((gate ?? initialGate(entries)).actions.map((a) => [a.entry, a]))
  return entries.map((entry) => {
    const action = actions.get(entry.id) ?? { entry: entry.id, selected: false }
    const plan = planFor(entry, action)
    const route = routeFor(entry, pull)
    const problem = action.selected
      ? (blocker(entry, action, plan) ?? (route ? undefined : unresolvedReason(entry)))
      : undefined
    return {
      entry,
      action,
      ...(plan ? { plan } : {}),
      ...(route ? { route } : {}),
      ...(problem ? { problem } : {}),
    }
  })
}

/** The selected entries that can be sent: they have a plan, any answer, and a route. */
export function readyItems(items: readonly GateItem[]): GateItem[] {
  return items.filter((item) => item.action.selected && !item.problem && item.plan && item.route)
}

/** A revision of the gate the author saw, so a stale Proceed is refused. */
export function gateRevision(fingerprint: string, gate: Gate | undefined): string {
  return stableId('gate', [fingerprint, gate?.actions ?? null])
}

function planFor(entry: ResolvedEntry, action: GateAction): string | undefined {
  if (action.plan && action.planBy === 'author') return action.plan
  if (action.plan && action.planBy === 'planner')
    return entry.verdict === 'authorsCall' && action.plannedFrom !== action.answer
      ? undefined
      : action.plan
  if (entry.resolution === 'disputed') return disputedPlan(entry, action)
  return entry.verdict === 'legit' ? entry.plan : undefined
}

function disputedPlan(entry: ResolvedEntry, action: GateAction): string | undefined {
  if (action.choice === 'list') return entry.verdict === 'legit' ? entry.plan : undefined
  if (action.choice !== 'other') return undefined
  const other = entry.other?.entries.find((candidate) => candidate.verdict === 'legit')
  return other?.plan
}

function blocker(entry: ResolvedEntry, action: GateAction, plan?: string): string | undefined {
  if (!entry.verdict)
    return `It needs evidence before it can be fixed: ${entry.missing ?? 'see the reason.'}`
  if (entry.verdict === 'authorsCall' && !action.answer) return 'Answer the question first.'
  if (plan) return undefined
  if (action.plan && action.planBy === 'planner')
    return 'The answer changed after the plan was written; write or ask for a new plan.'
  if (entry.resolution === 'disputed' && !action.choice)
    return 'The models disagree; choose a position or write a plan.'
  if (entry.verdict === 'authorsCall')
    return 'Write a plan from your answer, or ask the models for one.'
  return 'The models rejected this finding; write the plan you want carried out.'
}

function routeFor(entry: ResolvedEntry, pull: number): GateRoute | undefined {
  const { destination } = entry
  if (destination.kind === 'metadata')
    return { kind: 'metadata', pull: destination.pull, field: destination.field }
  if (destination.kind === 'code')
    return destination.pull === pull ? { kind: 'fix' } : { kind: 'layer', pull: destination.pull }
  return undefined
}

function unresolvedReason(entry: ResolvedEntry): string {
  return entry.destination.kind === 'unresolved'
    ? `Where to make this change is unresolved: ${entry.destination.reason}`
    : 'Where to make this change is unresolved.'
}
