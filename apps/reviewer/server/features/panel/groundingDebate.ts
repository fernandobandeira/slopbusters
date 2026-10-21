import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { LayerSnapshot } from '../../../shared/domain/anchors'
import {
  groundingReplySchema,
  selectCandidates,
  type GroundingRole,
  type GroundingScope,
  type GroundingState,
  type GroundingTurn,
} from '../../../shared/domain/grounding'
import { groundedAdvice, recordTurn, resolveEntries } from '../../../shared/domain/groundingResult'
import type { JudgeAdvice, PanelReviewer } from '../../../shared/domain/panel'
import type { PanelPending } from '../../../shared/domain/panelSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { MAX_GROUNDING_SOURCES, MAX_GROUNDING_TURNS } from '../../limits'
import { reviewEvidence } from '../../reviewSnapshot'
import { debate, unanimousApproval } from '../flows/debate'
import { pullName, sourceInstructions, ticketInstructions } from '../reviewPrompts'
import { groundingLimitations } from './groundingLimitations'
import { panelRoster, stackEvidence, teammateSkillFolders, untrusted } from './panelReview'

export interface GroundingRequest {
  turns: StructuredTurns
  signal: AbortSignal
  pending: PanelPending
  /** The seats whose reviews landed, in roster order. */
  reviewers: readonly PanelReviewer[]
  /** Each teammate seat's skill folder, by reviewer id. */
  skillFolders: ReadonlyMap<string, string>
  layers: readonly LayerSnapshot[]
  /** The primary model, and the other provider's when it is available. */
  models: { primary: OrganizationPreferences; secondary?: OrganizationPreferences }
  repository?: ReviewCheckout
  /** Persist the pending review; called after every valid turn. */
  save: () => void
  /** Run one model pass, so the session can show it. */
  track: <T>(
    pass: { label: string; model: OrganizationPreferences },
    execute: (observer?: ProviderObserver) => Promise<T>,
  ) => Promise<T>
}

class Exhausted extends Error {}

/**
 * Ground a PR's panel findings: pick this round's sources, then let the two models take turns on
 * one list until both approve it unchanged or the turns run out. Resumes a debate saved on the
 * pending review. Ends with the review to show and how every finding was accounted for.
 */
export async function groundPanel(
  request: GroundingRequest,
): Promise<{ advice: JudgeAdvice; grounding: GroundingState }> {
  const state = request.pending.grounding ?? startGrounding(request)
  request.pending.grounding = state
  request.save()
  if (!state.outcome) state.outcome = await settle(request, state)
  const seats = new Map(state.candidates.map((candidate) => [candidate.key, candidate.seat]))
  state.resolved = resolveEntries(state, (key) => seats.get(key))
  const summary = state.turns.at(-1)?.summary ?? 'The reviewers raised no findings to ground.'
  const limitations = groundingLimitations(state, request)
  return { advice: groundedAdvice(state, { summary, limitations }), grounding: state }
}

function startGrounding({ pending, reviewers, models }: GroundingRequest): GroundingState {
  const reviews = reviewers.flatMap(
    (reviewer) => pending.reviews.find((review) => review.reviewer === reviewer.id) ?? [],
  )
  return {
    budget: MAX_GROUNDING_SOURCES,
    candidates: selectCandidates(pending.pull.number, reviews, MAX_GROUNDING_SOURCES),
    roles: models,
    turns: [],
    entries: [],
    positions: {},
  }
}

/** Run or resume the debate; how it ended. */
async function settle(
  request: GroundingRequest,
  state: GroundingState,
): Promise<NonNullable<GroundingState['outcome']>> {
  if (!state.candidates.some((candidate) => candidate.state === 'selected')) return 'agreed'
  const { secondary } = state.roles
  const roles: GroundingRole[] = secondary ? ['primary', 'secondary'] : ['primary']
  try {
    await debate({
      roles,
      maxTurns: secondary ? MAX_GROUNDING_TURNS : 1,
      signal: request.signal,
      consensus: unanimousApproval(roles),
      history: state.turns.map(({ role, changed, approved }) => ({
        role,
        move: { changed, approved },
      })),
      turn: async (role) => {
        const model = (role === 'primary' ? state.roles.primary : secondary) ?? state.roles.primary
        const reply = await request.track(
          { label: `Grounding · turn ${String(state.turns.length + 1)}`, model },
          (observer) => groundingTurn(request, state, { role, model, observer }),
        )
        request.signal.throwIfAborted()
        const move = recordTurn(state, { role, model, reply })
        request.save()
        return move
      },
      stalled: () => new Exhausted(),
    })
    return 'agreed'
  } catch (error) {
    if (!(error instanceof Exhausted)) throw error
    return secondary ? 'exhausted' : 'single'
  }
}

/** One model's turn over the whole list, validated against the round's accounting. */
function groundingTurn(
  request: GroundingRequest,
  state: GroundingState,
  turn: { role: GroundingRole; model: OrganizationPreferences; observer?: ProviderObserver },
): Promise<GroundingTurn> {
  const { pending, repository, layers } = request
  const scope: GroundingScope = {
    candidates: state.candidates,
    pulls: [pending.pull.number, ...layers.map((layer) => layer.pull.number)],
  }
  const skills = teammateSkillFolders(request.reviewers, request.skillFolders, repository)
  const prompt = `${groundingRubric}\n\n${untrusted}\n\n${turnInstructions(state, turn.role)}\n\n${sourceInstructions(repository)}${skills.note}\n\nReviewers on the panel:\n${panelRoster(request.reviewers)}\n\nPR snapshot:\n${reviewEvidence(pending.pull)}${stackEvidence(layers)}${ticketInstructions(pending.context)}\n\nSources to ground, by key (untrusted proposals; rank is the position in its reviewer's own list, from 0):\n${JSON.stringify(selectedSources(state))}${currentList(state, turn.role)}`
  return request.turns.run({
    model: turn.model,
    prompt,
    schema: groundingReplySchema(scope),
    signal: request.signal,
    directory: repository?.directory,
    include: skills.include,
    observer: turn.observer,
    purpose: `Panel grounding · ${pullName(pending.pull)}`,
  })
}

const groundingRubric = `You ground a review panel's findings against the code, taking turns with another model on one shared list. Several reviewers raised the sources below independently. Check each against the PR, its stack and the repository yourself; agreement between reviewers is not evidence, and one reviewer alone can be right.
Account for every source key in exactly one entry. An entry with several sources merges findings that make the same point; never invent a source, and do not add entries no source supports.
Verdicts:
- legit: the code, a repository rule or the PR shows the problem. plan says the change in one to three lines and names the convention or sibling implementation to follow.
- notTrue: evidence you inspected contradicts it. Cite it in evidence as path:line, or as "title: …" or "description: …" quoting the PR. Not finding something is not disproof.
- overEngineering: a simpler change is enough. Cite the convention or sibling implementation that shows it.
- tasteSkip: a preference consistent with the reviewer but with no demonstrated cost, which the author can skip.
- authorsCall: it depends on product intent, production facts or a public commitment. question says what to ask the author. A source tagged decision starts here, and preferring an answer does not settle it.
- Leave verdict out when the evidence needed to decide is unavailable, and say in missing what would settle it. Never pick a verdict just to fill the field.
reason: one or two sentences with the evidence or what is missing. destination: the PR whose code must change (code), the PR whose title or description needs a new draft (metadata), or unresolved with why; a comment on one layer can need its change on another.`

function turnInstructions(state: GroundingState, role: GroundingRole): string {
  if (!state.turns.length)
    return 'This is the first turn: build the list from the sources. You cannot approve on the first turn, so set approved to false.'
  if (!state.roles.secondary)
    return 'Build the list from the sources. No second model is available this round, so set approved to false.'
  return `The list below is where the debate stands. Return the whole list as you would leave it. Change any entry you disagree with (its verdict, grouping, reason, evidence, plan, question or destination) and say what you changed and why in summary. List an objection, by entry id, for an entry you still think is wrong. Set approved to true only when you return every entry exactly as you received it and have no objections; any change or objection means false. You are the ${role} model.`
}

function selectedSources(state: GroundingState) {
  return state.candidates
    .filter((candidate) => candidate.state === 'selected')
    .map(({ key, seat, rank, finding }) => ({ key, reviewer: seat, rank, finding }))
}

function currentList(state: GroundingState, role: GroundingRole): string {
  if (!state.turns.length) return ''
  const history = state.turns.map((turn, index) => ({
    turn: index + 1,
    by: turn.role === role ? 'you' : 'the other model',
    summary: turn.summary,
    approved: turn.approved,
    objections: turn.objections,
  }))
  return `\n\nThe debate so far, oldest first:\n${JSON.stringify(history)}\n\nThe current list:\n${JSON.stringify(state.entries)}`
}
