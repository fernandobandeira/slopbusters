import { randomUUID } from 'node:crypto'
import { seatRequests } from '../../../shared/domain/panel'
import {
  gateItems,
  gateRevision,
  readyItems,
  type GateItem,
} from '../../../shared/domain/panelGate'
import type { FixHandoff } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import type { PullRequest } from '../../../shared/domain/types'
import type { FixWorktree } from '../../adapters/fixWorktrees'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import type { ChatHosts } from '../../adapters/t3Engine/chatHosts'
import { publicError, UserError } from '../../errors'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { engineModel } from '../chat/personaChats'
import { fixSeed } from './fixSeed'
import { committedFixes } from './localRound'
import type { PanelJobs } from './panelJobs'

interface Options {
  store: PanelSessionStore
  hosts: ChatHosts
  loadPull: (url: string) => Promise<PullRequest>
  /** The model fix threads run on: the primary review model. */
  model: () => OrganizationPreferences
  prepareWorktree: (checkout: string, pull: PullRequest, sha: string) => Promise<FixWorktree>
  /** Starts the round that reviews a fix thread's local commits. */
  jobs?: Pick<PanelJobs, 'start'>
  sessions?: AgentSessions
}

/**
 * Proceed: send the author's ready fixes for one reviewed PR to a T3 Code thread in a worktree of
 * the reviewed head. Each gate revision launches at most once; a repeat finds the saved launch.
 */
export class PanelFixes {
  private readonly launching = new Map<string, Promise<PanelSession>>()

  constructor(private readonly options: Options) {}

  proceed(id: string, url: string, revision: string): Promise<PanelSession> {
    const key = JSON.stringify([id, url])
    const running = this.launching.get(key)
    if (running) return running
    const launch = this.launch(id, url, revision).finally(() => {
      this.launching.delete(key)
    })
    this.launching.set(key, launch)
    return launch
  }

  /**
   * Review a fix thread's committed local fixes in a new round with the same panel. GitHub need not
   * have them; unsaved changes, or a branch with no new commits, are refused.
   */
  async reviewLocal(id: string, url: string): Promise<PanelSession> {
    const { session, result } = this.find(id, url)
    const launch = result.handoff?.state === 'sent' ? result.handoff.launch : undefined
    if (!launch || !this.options.jobs)
      throw new UserError('Send fixes to a fix thread before reviewing them.')
    const sha = await committedFixes(launch.worktreePath, launch.reviewedSha)
    return this.options.jobs.start(
      session.repository,
      [url],
      seatRequests(session.reviewers, session.model.provider),
      {
        local: {
          url,
          worktreePath: launch.worktreePath,
          branch: launch.branch,
          sha,
          reviewedSha: launch.reviewedSha,
          mergeBaseSha: result.pull.mergeBaseSha ?? result.pull.baseSha,
          from: session.id,
        },
      },
    )
  }

  private async launch(id: string, url: string, revision: string): Promise<PanelSession> {
    const { session, result } = this.find(id, url)
    const previous = result.handoff
    if (previous?.state === 'sent') {
      if (previous.revision === revision) return session
      throw new UserError(
        'Fixes from this review were already sent to a T3 Code thread. Review the fixes, or ask the panel again for another round.',
        409,
      )
    }
    const items = await this.readyFixes(url, result, revision, Boolean(session.local))
    const handoff: FixHandoff = {
      revision,
      // A retry after a failed launch reuses the thread id, so it cannot start a second thread.
      threadId: previous?.threadId ?? randomUUID(),
      state: 'preparing',
      createdAt: new Date().toISOString(),
      entries: items.map((item) => item.entry.id),
    }
    this.save(id, url, handoff)
    try {
      const launch = await this.startThread(result, items, handoff.threadId)
      return this.save(id, url, { ...handoff, state: 'sent', launch })
    } catch (error) {
      this.save(id, url, { ...handoff, state: 'failed', error: publicError(error) })
      throw error
    }
  }

  /** The fixes for this PR the author saw ready, provided the PR is still at the reviewed head. */
  private async readyFixes(url: string, result: PanelResult, revision: string, local: boolean) {
    if (revision !== gateRevision(result.fingerprint, result.gate))
      throw new UserError(
        'Your choices changed since you pressed Proceed. Check them and try again.',
        409,
      )
    const items = readyItems(
      gateItems(result.grounding?.resolved ?? [], result.gate, result.pull.number),
    ).filter((item) => item.route?.kind === 'fix')
    if (!items.length) throw new UserError('Choose at least one fix for this PR that is ready.')
    // A local round reviewed commits GitHub does not have; its next fixes start from them.
    if (local) return items
    const current = await this.options.loadPull(url)
    if (current.headSha !== result.pull.headSha || current.baseSha !== result.pull.baseSha)
      throw new UserError(
        'This PR has new commits since the panel reviewed it. Review the current PR before sending fixes.',
        409,
      )
    return items
  }

  /** Prepare the worktree, then create the thread with its seed; it is sent once both succeed. */
  private async startThread(
    result: PanelResult,
    items: GateItem[],
    threadId: string,
  ): Promise<NonNullable<FixHandoff['launch']>> {
    const { pull } = result
    const workspace = await this.options.hosts.workspaceFor(pull)
    const worktree = await this.options.prepareWorktree(
      workspace.project.workspaceRoot,
      pull,
      pull.headSha,
    )
    const title = `Fix PR #${String(pull.number)}: ${String(items.length)} panel ${items.length === 1 ? 'fix' : 'fixes'}`
    await workspace.threads.startThread({
      threadId,
      projectId: workspace.project.id,
      title,
      model: engineModel(this.options.model()),
      branch: worktree.branch,
      worktreePath: worktree.path,
      pullRequest: {
        host: 'github.com',
        repository: `${pull.owner}/${pull.repo}`,
        number: pull.number,
        url: pull.url,
      },
      message: fixSeed({ pull, worktree, items, candidates: result.grounding?.candidates ?? [] }),
    })
    await workspace.open(threadId).catch(() => undefined)
    return {
      title,
      project: workspace.project.title,
      location: workspace.location,
      branch: worktree.branch,
      worktreePath: worktree.path,
      reviewedSha: pull.headSha,
      baseSha: pull.baseSha,
    }
  }

  private find(id: string, url: string): { session: PanelSession; result: PanelResult } {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    if (session.status === 'running')
      throw new UserError('Wait for the panel to finish before sending fixes.')
    const result = session.results.find((item) => item.pull.url === url)
    if (!result?.grounding?.resolved)
      throw new UserError('This PR has no grounded findings to fix.')
    return { session, result }
  }

  /** Save the handoff on the latest session, so choices saved meanwhile are kept. */
  private save(id: string, url: string, handoff: FixHandoff): PanelSession {
    const { session, result } = this.find(id, url)
    result.handoff = handoff
    this.options.store.save(session)
    this.options.sessions?.sync('panel', session)
    return session
  }
}
