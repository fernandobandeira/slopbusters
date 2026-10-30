import { z } from 'zod'
import type { ProviderObserver } from '../../../shared/domain/agentSession'
import type { ResolvedEntry } from '../../../shared/domain/grounding'
import { initialGate, type Gate, type GateAction } from '../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import type { PullRequest } from '../../../shared/domain/types'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import { PLANNING_TIMEOUT_MS } from './limits'
import { reviewEvidence } from '../../reviewSnapshot'
import { transferInstructions } from '../transferPrompt'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { pullName, sourceInstructions } from '../reviewPrompts'
import { untrusted } from './panelReview'

interface Options {
  store: PanelSessionStore
  turns: StructuredTurns
  /** The grounding models of a session that saved none. */
  judges: () => { primary: OrganizationPreferences }
  sessions?: AgentSessions
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
}

const planSchema = z.object({ plan: z.string().trim().min(1).max(400) }).strict()

/**
 * The author's decisions on a reviewed PR before any fix starts: what to fix, their answers, and
 * plans they write or ask the grounding models for. The models' verdicts are never changed.
 */
export class PanelGates {
  constructor(private readonly options: Options) {}

  save(id: string, url: string, gate: Gate): PanelSession {
    const { session, result } = this.find(id, url)
    const entries = new Set(result.grounding?.resolved?.map((entry) => entry.id))
    const chosen = gate.actions.map((action) => action.entry)
    if (new Set(chosen).size !== chosen.length || chosen.some((entry) => !entries.has(entry)))
      throw new UserError('These choices do not match the grounded findings. Reload and try again.')
    result.gate = gate
    this.persist(session)
    return session
  }

  /** Ask the stronger primary model for one entry's plan, from the author's answer if any. */
  async plan(id: string, url: string, entryId: string): Promise<PanelSession> {
    const { result } = this.find(id, url)
    const entry = result.grounding?.resolved?.find((item) => item.id === entryId)
    if (!entry) throw new UserError('That finding is not in this review.')
    if (!entry.verdict) throw new UserError('This finding needs evidence before it can be planned.')
    const answer = actionOf(result, entryId).answer
    if (entry.verdict === 'authorsCall' && !answer)
      throw new UserError('Answer the question first.')
    const plan = await this.writePlan(this.find(id, url).session, result, entry, answer)
    // The author may have changed the gate while the model wrote; apply the plan to the latest.
    const latest = this.find(id, url)
    const action = {
      ...actionOf(latest.result, entryId),
      selected: true,
      plan,
      planBy: 'planner' as const,
    }
    if (answer) action.plannedFrom = answer
    const gate = latest.result.gate ?? initialGate(latest.result.grounding?.resolved ?? [])
    latest.result.gate = {
      actions: gate.actions.some((item) => item.entry === entryId)
        ? gate.actions.map((item) => (item.entry === entryId ? action : item))
        : [...gate.actions, action],
    }
    this.persist(latest.session)
    return latest.session
  }

  private async writePlan(
    session: PanelSession,
    result: PanelResult,
    entry: ResolvedEntry,
    answer?: string,
  ): Promise<string> {
    const model = (session.judges ?? this.options.judges()).primary
    const controller = new AbortController()
    const repository = await this.options.openRepository?.(result.pull, controller.signal)
    try {
      const sources = (result.grounding?.candidates ?? [])
        .filter((candidate) => entry.sources.includes(candidate.key))
        .map(({ key, seat, finding }) => ({ key, reviewer: seat, finding }))
      const prompt = `${planningRubric}\n\n${untrusted}\n\n${sourceInstructions(repository)}${transferInstructions(result.pull)}\n\nPR snapshot:\n${reviewEvidence(result.pull)}\n\nThe grounded finding:\n${JSON.stringify(entry)}\n\nIts sources (untrusted proposals):\n${JSON.stringify(sources)}${answer ? `\n\nThe author's answer to "${entry.question ?? ''}":\n${JSON.stringify(answer)}` : ''}`
      const run = (observer?: ProviderObserver) =>
        this.options.turns.run({
          model,
          prompt,
          schema: planSchema,
          signal: controller.signal,
          directory: repository?.directory,
          observer,
          timeoutMs: PLANNING_TIMEOUT_MS,
          purpose: `Panel plan · ${pullName(result.pull)}`,
        })
      const reply = this.options.sessions
        ? await this.options.sessions.run(
            session.id,
            { label: `Plan ${entry.id}`, url: result.pull.url, model },
            run,
          )
        : await run()
      return reply.plan
    } finally {
      repository?.release()
    }
  }

  private find(id: string, url: string) {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    if (session.status === 'running')
      throw new UserError('Wait for the panel to finish before choosing fixes.')
    const result = session.results.find((item) => item.pull.url === url)
    if (!result?.grounding?.resolved)
      throw new UserError('This PR has no grounded findings to choose from.')
    return { session, result }
  }

  private persist(session: PanelSession) {
    this.options.store.save(session)
    this.options.sessions?.sync('panel', session)
  }
}

function actionOf(result: PanelResult, entry: string): GateAction {
  const gate = result.gate ?? initialGate(result.grounding?.resolved ?? [])
  return gate.actions.find((action) => action.entry === entry) ?? { entry, selected: false }
}

const planningRubric = `The author chose to fix one finding a review panel raised, after two models grounded it against the code. Write the plan a coding agent will carry out: one to three lines saying what to change, where, and which convention or sibling implementation to follow. Check the repository yourself; the finding and its sources are proposals, not facts. When the author answered a question, the plan follows their answer. Do not plan changes beyond this finding.`
