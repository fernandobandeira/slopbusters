import { z } from 'zod'
import { leadSource } from '../../../shared/domain/grounding'
import { gateItems } from '../../../shared/domain/panelGate'
import { fixCheckStatuses, type FixHandoff, type LocalRound } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import type { PullRequest } from '../../../shared/domain/types'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import type { ReviewCheckout } from '../../adapters/reviewWorkspaces'
import type { StructuredTurns } from '../../adapters/t3Engine/engineTurns'
import { UserError } from '../../errors'
import { PLANNING_TIMEOUT_MS } from '../../limits'
import { reviewEvidence } from '../../reviewSnapshot'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { pullName, sourceInstructions } from '../reviewPrompts'
import { committedFixes } from './localRound'
import { untrusted } from './panelReview'

interface Options {
  store: PanelSessionStore
  turns: StructuredTurns
  /** The other provider's model; the fix thread ran on the primary one. */
  checker: () => OrganizationPreferences | undefined
  loadLocal: (local: LocalRound) => Promise<PullRequest>
  openRepository?: (pull: PullRequest, signal: AbortSignal) => Promise<ReviewCheckout>
  sessions?: AgentSessions
}

const checkReply = (entries: readonly string[]) =>
  z
    .object({
      summary: z.string().trim().min(1).max(1000),
      results: z
        .array(
          z
            .object({
              entry: z.enum(entries as [string, ...string[]]),
              status: z.enum(fixCheckStatuses),
              note: z.string().trim().min(1).max(400),
              evidence: z.array(z.string().min(1).max(200)).max(4),
            })
            .strict(),
        )
        .max(40),
    })
    .strict()
    .refine(
      (reply) =>
        reply.results.length === entries.length &&
        new Set(reply.results.map((result) => result.entry)).size === entries.length,
      { message: 'Give exactly one result for every fix that was sent.' },
    )

/**
 * Check local fixes: the bundled engine cannot delegate from the fix thread to the other provider,
 * so the author asks for it. That provider's model reads the committed local diff and source and
 * says, for each sent plan, whether it was applied. It changes no code and posts nothing.
 */
export class FixChecks {
  constructor(private readonly options: Options) {}

  async check(id: string, url: string): Promise<PanelSession> {
    const { session, result, handoff } = this.find(id, url)
    const launch = handoff.launch
    if (!launch) throw new UserError('Send fixes to a fix thread before checking them.')
    const model = this.options.checker()
    if (!model)
      throw new UserError('Checking fixes needs the other provider. Set it up in Settings.')
    const sha = await committedFixes(launch.worktreePath, launch.reviewedSha)
    const local: LocalRound = {
      url,
      worktreePath: launch.worktreePath,
      branch: launch.branch,
      sha,
      reviewedSha: launch.reviewedSha,
      mergeBaseSha: result.pull.mergeBaseSha ?? result.pull.baseSha,
      from: session.id,
    }
    const pull = await this.options.loadLocal(local)
    const controller = new AbortController()
    const repository = await this.options.openRepository?.(pull, controller.signal)
    try {
      const run = () =>
        this.options.turns.run({
          model,
          prompt: `${checkRubric}\n\n${untrusted}\n\n${sourceInstructions(repository)}\n\nThe PR with its fixes, diffed from the reviewed merge base (it includes the PR's own changes; the fixes are the commits after ${launch.reviewedSha}):\n${reviewEvidence(pull)}\n\nThe fixes that were sent, by entry:\n${JSON.stringify(sentPlans(result, handoff))}`,
          schema: checkReply(handoff.entries),
          signal: controller.signal,
          directory: repository?.directory,
          timeoutMs: PLANNING_TIMEOUT_MS,
          purpose: `Panel fix check · ${pullName(result.pull)}`,
        })
      const reply = this.options.sessions
        ? await this.options.sessions.run(
            session.id,
            { label: 'Check local fixes', url, model },
            run,
          )
        : await run()
      const latest = this.find(id, url)
      latest.handoff.check = { sha, model, ...reply, createdAt: new Date().toISOString() }
      this.options.store.save(latest.session)
      this.options.sessions?.sync('panel', latest.session)
      return latest.session
    } finally {
      repository?.release()
    }
  }

  private find(id: string, url: string) {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    const result = session.results.find((item) => item.pull.url === url)
    const handoff = result?.handoff
    if (!result || handoff?.state !== 'sent')
      throw new UserError('Send fixes to a fix thread before checking them.')
    return { session, result, handoff }
  }
}

function sentPlans(result: PanelResult, handoff: FixHandoff) {
  const candidates = result.grounding?.candidates ?? []
  return gateItems(result.grounding?.resolved ?? [], result.gate, result.pull.number)
    .filter((item) => handoff.entries.includes(item.entry.id))
    .map(({ entry, action, plan }) => ({
      entry: entry.id,
      title: leadSource(entry, candidates)?.finding.title ?? entry.id,
      plan,
      ...(entry.question && action.answer ? { authorAnswer: action.answer } : {}),
      reason: entry.reason,
    }))
}

const checkRubric = `A coding agent was asked to apply the plans below to a PR and commit them. You are a second model checking its work; you did not write it. For every plan, read the committed code yourself and say whether it was applied: applied when the change does what the plan says, partial when some of it is missing, missing when nothing was done, wrong when the change does something else or breaks what the plan meant to keep. note says what you saw in one or two sentences; evidence cites path:line. Judge only these plans; do not review the rest of the PR.`
