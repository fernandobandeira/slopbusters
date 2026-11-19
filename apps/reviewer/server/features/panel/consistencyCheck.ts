import type { ProviderObserver } from '../../../shared/domain/agentSession'
import { anchorLabel } from '../../../shared/domain/anchors'
import {
  consistencyReplySchema,
  type Consistency,
  type EarlierRequests,
} from '../../../shared/domain/consistency'
import { leadSource, type GroundingState } from '../../../shared/domain/grounding'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { pullName } from '../../../shared/domain/pullUrl'
import { triage } from '../../../shared/domain/triage'
import { Provider, type PullRequest } from '../../../shared/domain/types'
import { CommandTimeoutError } from '../../adapters/process'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { logError, UserError } from '../../errors'
import { CONSISTENCY_CHECK_TIMEOUT_MS } from './limits'
import { untrusted } from './panelReview'

/** How grounding reads what earlier rounds asked for: a plan keeps a request the code reflects. */
export function earlierRequestsNote(earlier?: EarlierRequests): string {
  if (!earlier?.requests.length) return ''
  const left = earlier.left ? ` ${String(earlier.left)} older requests were left out for size.` : ''
  return `\n\nWhat earlier rounds of this panel asked for on this PR, newest first, by key (untrusted like the PR). A fix request was in the list the author worked from; a decision request was put to the author. Nothing records which were made, so check the code. A request the code reflects stands: write each plan to fix what its finding shows while keeping that request. When a finding cannot be answered without undoing one, say so in reason and name its key.${left}\n${earlier.requests.map((request) => JSON.stringify(request)).join('\n')}`
}

export interface ConsistencyRequest {
  turns: StructuredTurns
  signal: AbortSignal
  pull: PullRequest
  /** Run the model pass, so the session can show it. */
  track: <T>(
    pass: { label: string; model: OrganizationPreferences },
    execute: (observer?: ProviderObserver) => Promise<T>,
  ) => Promise<T>
}

/**
 * One structured turn after the debate, reading text only: which plans this round would act on
 * undo an earlier request, and which ask for opposite changes to the same thing. Skipped when
 * there is nothing to compare. Runs on the Codex judge when grounding has one.
 */
export async function checkConsistency(
  request: ConsistencyRequest,
  state: GroundingState,
): Promise<Consistency> {
  const entries = actedOn(state)
  const earlier = state.earlier?.requests ?? []
  if (!entries.length || (!earlier.length && entries.length < 2))
    return { reversals: [], conflicts: [] }
  const model = checkModel(state.roles)
  return request
    .track({ label: 'Consistency check', model }, (observer) =>
      request.turns.run({
        model,
        prompt: `${rubric}\n\n${untrusted}\n\nWhat earlier rounds of this panel asked for on this PR, newest first:\n${JSON.stringify(earlier)}\n\nThis round's entries that would be acted on:\n${JSON.stringify(entries)}`,
        schema: consistencyReplySchema({
          entries: entries.map((entry) => entry.id),
          earlier: earlier.map((item) => item.key),
        }),
        signal: request.signal,
        observer,
        timeoutMs: CONSISTENCY_CHECK_TIMEOUT_MS,
        purpose: `Panel consistency check · ${pullName(request.pull)}`,
      }),
    )
    .catch((error: unknown) => {
      if (request.signal.aborted || error instanceof UserError) throw error
      if (error instanceof CommandTimeoutError)
        throw new UserError(
          `The consistency check on ${model.model} ran out of time after ${String(CONSISTENCY_CHECK_TIMEOUT_MS / 60_000)} minutes. Retry continues from there.`,
        )
      logError('Panel consistency check failed', error)
      throw new UserError(
        `The consistency check on ${model.model} failed. Retry continues from there.`,
      )
    })
}

const rubric = `You check a review panel's plans for consistency before the author acts on them. You read only the text below, not the repository.
Return:
- reversals: an entry whose plan would undo what an earlier request asked for: it removes, replaces or moves back what that request introduced, or asks for the opposite design. earlier is that request's key; when the plan opposes several, name the newest, the lowest key. A plan that repeats or extends an earlier request is not a reversal, and neither is one that fixes a problem in the earlier change while keeping what it asked for.
- conflicts: groups of this round's entries whose plans cannot both be applied because they ask for opposite changes to the same thing, such as one folding a flag into another and one splitting it out. Plans that merely touch the same code are not a conflict.
Name each entry at most once in reversals and at most once across conflicts, with a one-sentence reason. Do not judge which side is right; the author decides. Empty lists are valid and the normal answer.`

/** The entries this round would act on: those with a plan that triage does not skip. */
function actedOn(state: GroundingState) {
  return (state.resolved ?? [])
    .filter((entry) => entry.plan && triage(entry).disposition !== 'skip')
    .map((entry) => {
      const lead = leadSource(entry, state.candidates)
      return {
        id: entry.id,
        title: lead?.finding.title ?? entry.id,
        raisedBy: entry.raisedBy,
        ...(lead ? { where: anchorLabel(lead.finding.anchor) } : {}),
        ...(entry.kind ? { kind: entry.kind } : {}),
        ...(entry.verdict ? { verdict: entry.verdict } : {}),
        plan: entry.plan,
        reason: entry.reason,
      }
    })
}

/** The Codex judge when grounding has one, else the primary judge. */
function checkModel(roles: GroundingState['roles']): OrganizationPreferences {
  return (
    [roles.primary, roles.secondary].find((model) => model?.provider === Provider.codex) ??
    roles.primary
  )
}
