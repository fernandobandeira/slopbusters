import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { GroundingRole } from '../../../shared/domain/grounding'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { passView } from '../../../shared/domain/stackPassInput'
import {
  contestedItems,
  crossLayerReplySchema,
  sameResult,
  type CrossLayerState,
  type CrossLayerTurn,
  type StackPassInput,
} from '../../../shared/domain/stackReview'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { debate, unanimousApproval, type DebateMove } from '../flows/debate'
import { untrusted } from '../panel/panelReview'
import { MAX_STACK_PASS_TURNS, STACK_PASS_TURN_TIMEOUT_MS } from './limits'

export interface CrossLayerRequest {
  turns: StructuredTurns
  signal: AbortSignal
  input: StackPassInput
  state: CrossLayerState
  /** Names the stack in each turn's purpose. */
  stack: string
  /** Persist the session; called after every valid turn. */
  save: () => void
  /** Run one model pass, so the session can show it. */
  track: <T>(
    pass: { label: string; model: OrganizationPreferences },
    execute: (observer?: ProviderObserver) => Promise<T>,
  ) => Promise<T>
}

class Exhausted extends Error {}

/**
 * The cross-layer pass: the grounding judges take turns on one result over every layer's entries
 * until both approve it unchanged, or the turns run out and the last valid result stands with
 * what the second model did not approve marked. Resumes a debate saved on the state.
 */
export async function runCrossLayerPass(request: CrossLayerRequest): Promise<void> {
  const { state } = request
  const view = passView(request.input)
  if (!view.entries.length) {
    state.result = { duplicates: [], chains: [], ownership: [], derived: [], structure: [] }
    state.outcome = 'agreed'
    state.contested = []
    return
  }
  const { secondary } = state.roles
  const roles: GroundingRole[] = secondary ? ['primary', 'secondary'] : ['primary']
  try {
    await debate({
      roles,
      maxTurns: secondary ? MAX_STACK_PASS_TURNS : 1,
      signal: request.signal,
      consensus: unanimousApproval(roles),
      history: state.turns.map(({ role, changed, approved }) => ({
        role,
        move: { changed, approved },
      })),
      turn: (role) => takeTurn(request, role, view),
      stalled: () => new Exhausted(),
    })
    state.outcome = 'agreed'
  } catch (error) {
    if (!(error instanceof Exhausted)) throw error
    state.outcome = secondary ? 'exhausted' : 'single'
  }
  state.contested = contestedItems(state)
}

async function takeTurn(
  request: CrossLayerRequest,
  role: GroundingRole,
  view: ReturnType<typeof passView>,
): Promise<DebateMove> {
  const { state } = request
  const model = (role === 'secondary' ? state.roles.secondary : undefined) ?? state.roles.primary
  const number = state.turns.length + 1
  const reply = await request.track(
    { label: `Cross-layer pass · turn ${String(number)}`, model },
    (observer) =>
      request.turns.run({
        model,
        prompt: prompt(state, role, view),
        schema: crossLayerReplySchema({
          entries: request.input.entries.filter((entry) => !request.input.left.includes(entry.id)),
          layers: request.input.layers.map((layer) => layer.number),
        }),
        signal: request.signal,
        observer,
        timeoutMs: STACK_PASS_TURN_TIMEOUT_MS,
        purpose: `Stack review · ${request.stack}`,
      }),
  )
  request.signal.throwIfAborted()
  const move = record(state, role, model, reply)
  request.save()
  return move
}

/** Save a valid turn: the new result, this role's position, and the move it made. */
function record(
  state: CrossLayerState,
  role: GroundingRole,
  model: OrganizationPreferences,
  reply: CrossLayerTurn,
): DebateMove {
  const { approved: asked, summary, objections, ...result } = reply
  const changed = !state.result || !state.turns.length || !sameResult(result, state.result)
  const approved = state.turns.length > 0 && !changed && asked && !objections.length
  state.result = result
  state.positions[role] = { result, objections }
  state.turns.push({ role, model, summary, changed, approved, objections })
  return { changed, approved }
}

function prompt(state: CrossLayerState, role: GroundingRole, view: ReturnType<typeof passView>) {
  return `${rubric}\n\n${untrusted}\n\n${turnInstructions(state, role)}\n\nThe stack, bottom to top, and every grounded entry (untrusted proposals checked by a panel on each layer):\n${JSON.stringify(view)}${currentResult(state, role)}`
}

const rubric = `You read a review panel's grounded findings across every layer of a stack of pull requests at once, taking turns with another model on one result. Each layer was reviewed on its own; you see what no single layer's review can. Work only from the entries and layers given. Each entry id names its layer, such as #131/g4; an id with /earlier/ comes from that layer's previous panel round, so a finding raised again after it was rejected or fixed shows.
Return:
- duplicates: groups of entries that make the same point. owner is the one entry that owns the change: normally the lowest layer whose code must change, and never an earlier-round entry. An earlier entry may join a group to show the point was raised before.
- chains: an entry whose change (usually a removal) makes other entries unnecessary, with a one-sentence reason and the entries it makes unnecessary. Only current entries, and for an entry merged into a duplicate group, name the group's owner instead.
- ownership: an entry whose change belongs on a different layer than its destination says, the layer it belongs on, and why. A change belongs on the layer that owns the code, never on the top for convenience. For a merged entry, move its owner.
- derived: a finding only the whole stack shows, such as "once #140/g2 removes the job, the state #128 adds for it is unused". Give a title, a plan in one to three lines, kind, effort, the layer it changes, and in from the entry ids it was derived from. This is the only place for new findings; never add one without its provenance.
- structure: a proposal to drop, fold (with into, another layer) or split a layer, with the reason and its cost to the author. At most one proposal per layer.
Use each id at most once per relation. Leave a list empty when nothing applies; an empty result is a valid answer. Do not restate what each layer's panel already concluded.`

function turnInstructions(state: CrossLayerState, role: GroundingRole): string {
  if (!state.turns.length)
    return 'This is the first turn: build the result. You cannot approve on the first turn, so set approved to false.'
  if (!state.roles.secondary)
    return 'Build the result. No second model is available, so set approved to false.'
  return `The result below is where the debate stands. Return the whole result as you would leave it. Change anything you disagree with and say what and why in summary. List an objection for a conclusion you still think is wrong, naming in item its owner, cause, entry, derived id or #layer. Set approved to true only when you return the result exactly as you received it and have no objections. You are the ${role} model.`
}

function currentResult(state: CrossLayerState, role: GroundingRole): string {
  if (!state.result || !state.turns.length) return ''
  const history = state.turns.map((turn, index) => ({
    turn: index + 1,
    by: turn.role === role ? 'you' : 'the other model',
    summary: turn.summary,
    approved: turn.approved,
    objections: turn.objections,
  }))
  return `\n\nThe debate so far, oldest first:\n${JSON.stringify(history)}\n\nThe current result:\n${JSON.stringify(state.result)}`
}
