import { z } from 'zod'
import { seatRequests } from '../../../shared/domain/panel'
import { gateItems, readyItems, type GateItem } from '../../../shared/domain/panelGate'
import { carriedAnchor, type CarriedFinding } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import { PLANNING_TIMEOUT_MS } from '../../limits'
import { reviewEvidence } from '../../reviewSnapshot'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { pullName } from '../reviewPrompts'
import type { PanelJobs } from './panelJobs'
import { untrusted } from './panelReview'

interface Options {
  store: PanelSessionStore
  turns: StructuredTurns
  jobs: Pick<PanelJobs, 'start'>
  /** The grounding models of a session that saved none. */
  judges: () => { primary: OrganizationPreferences }
  sessions?: AgentSessions
}

type MetadataField = 'title' | 'description'

const draftSchemas = {
  title: z.object({ text: z.string().trim().min(1).max(256) }).strict(),
  description: z.object({ text: z.string().trim().min(1).max(60_000) }).strict(),
}

/**
 * The chosen fixes that do not go to this PR's fix thread: findings for another layer start a
 * round there that grounds them again, and title or description plans become drafts the author
 * edits and copies. Nothing here publishes to GitHub.
 */
export class PanelRoutes {
  constructor(private readonly options: Options) {}

  /** Start a round on another layer with the same panel, carrying the findings chosen for it. */
  async toLayer(id: string, url: string, pull: number): Promise<PanelSession> {
    const { session, result } = this.find(id, url)
    if (result.routed?.some((route) => route.pull === pull)) return session
    const items = this.ready(result).filter(
      (item) => item.route?.kind === 'layer' && item.route.pull === pull,
    )
    if (!items.length) throw new UserError(`No ready finding belongs on PR #${String(pull)}.`)
    const target = `https://github.com/${result.pull.owner}/${result.pull.repo}/pull/${String(pull)}`
    const round = await this.options.jobs.start(
      session.repository,
      [target],
      seatRequests(session.reviewers, session.model.provider),
      carriedFindings(result, items, target, pull),
    )
    const latest = this.find(id, url)
    latest.result.routed = [
      ...(latest.result.routed ?? []),
      {
        pull,
        session: round.id,
        entries: items.map((item) => item.entry.id),
        createdAt: new Date().toISOString(),
      },
    ]
    this.persist(latest.session)
    return latest.session
  }

  /** Draft the PR's new title or description from the metadata plans the author chose. */
  async draftMetadata(id: string, url: string, field: MetadataField): Promise<PanelSession> {
    const { session, result } = this.find(id, url)
    const items = this.ready(result).filter(
      (item) =>
        item.route?.kind === 'metadata' &&
        item.route.field === field &&
        item.route.pull === result.pull.number,
    )
    if (!items.length) throw new UserError(`No ready change belongs in the PR ${field}.`)
    const model = (session.judges ?? this.options.judges()).primary
    const run = () =>
      this.options.turns.run({
        model,
        prompt: metadataPrompt(result, field, items),
        schema: draftSchemas[field],
        signal: new AbortController().signal,
        timeoutMs: PLANNING_TIMEOUT_MS,
        purpose: `Panel ${field} draft · ${pullName(result.pull)}`,
      })
    const reply = this.options.sessions
      ? await this.options.sessions.run(
          session.id,
          { label: `Draft the ${field}`, url: result.pull.url, model },
          run,
        )
      : await run()
    const latest = this.find(id, url)
    latest.result.metadataDrafts = [
      ...(latest.result.metadataDrafts ?? []).filter((draft) => draft.field !== field),
      {
        field,
        text: reply.text,
        entries: items.map((item) => item.entry.id),
        createdAt: new Date().toISOString(),
      },
    ]
    this.persist(latest.session)
    return latest.session
  }

  private ready(result: PanelResult): GateItem[] {
    return readyItems(gateItems(result.grounding?.resolved ?? [], result.gate, result.pull.number))
  }

  private find(id: string, url: string) {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    if (session.status === 'running')
      throw new UserError('Wait for the panel to finish before routing fixes.')
    const result = session.results.find((item) => item.pull.url === url)
    if (!result?.grounding?.resolved)
      throw new UserError('This PR has no grounded findings to route.')
    return { session, result }
  }

  private persist(session: PanelSession) {
    this.options.store.save(session)
    this.options.sessions?.sync('panel', session)
  }
}

/** Every source behind the chosen entries, in its reviewers' words, placed on the target layer. */
function carriedFindings(
  result: PanelResult,
  items: readonly GateItem[],
  url: string,
  pull: number,
): CarriedFinding[] {
  const candidates = result.grounding?.candidates ?? []
  return items.flatMap((item) =>
    candidates
      .filter((candidate) => item.entry.sources.includes(candidate.key))
      .map((candidate) => ({
        url,
        from: { pull: result.pull.number, entry: item.entry.id },
        seat: candidate.seat,
        finding: { ...candidate.finding, anchor: carriedAnchor(candidate.finding.anchor, pull) },
      })),
  )
}

function metadataPrompt(result: PanelResult, field: MetadataField, items: readonly GateItem[]) {
  const plans = items.map(({ entry, action, plan }) => ({
    plan,
    reason: entry.reason,
    ...(entry.question && action.answer
      ? { question: entry.question, authorAnswer: action.answer }
      : {}),
  }))
  return `The author of a PR chose changes to its ${field} after a review panel. Write the complete new ${field}: the current text with exactly these changes applied, keeping everything else, its language, structure and formatting. Do not add claims the PR snapshot does not support. Return only the new text.\n\n${untrusted}\n\nPR snapshot:\n${reviewEvidence(result.pull)}\n\nThe current ${field}:\n${JSON.stringify(result.pull[field])}\n\nThe changes to apply:\n${JSON.stringify(plans)}`
}
