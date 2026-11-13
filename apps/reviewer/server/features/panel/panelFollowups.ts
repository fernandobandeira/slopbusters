import type { z } from 'zod'
import type { FollowUpOptions, FollowUpTicket } from '../../../shared/domain/panelFollowups'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { PullRequest } from '../../../shared/domain/types'
import { triage } from '../../../shared/domain/triage'
import type { Linear } from '../../adapters/linear'
import type { PanelSessionStore } from '../../adapters/panelSessionStore'
import { createCache } from '../../cache'
import { logError, publicError, UserError } from '../../errors'
import type { AgentSessions } from '../agent-sessions/agentSessions'
import { followUpContent } from './followUpDescription'
import * as queries from './followUpQueries'

interface Options {
  store: PanelSessionStore
  linear: Linear
  linked: (pull: PullRequest) => Promise<string | null>
  sessions?: AgentSessions
}

/** Create each issue once, saving it before attempting the next issue or its relation. */
export class PanelFollowups {
  private readonly filing = createCache<FollowUpTicket>({ max: 0 })
  constructor(private readonly options: Options) {}

  async choices(id: string, url: string): Promise<FollowUpOptions> {
    const { teams, linked } = await this.context(id, url)
    return { teams, linked }
  }

  private async context(id: string, url: string) {
    this.connected()
    const { result } = this.find(id, url)
    const [viewer, identifier] = await Promise.all([
      this.viewer(),
      this.options.linked(result.pull),
    ])
    const linked = identifier
      ? (
          await this.options.linear.request(
            queries.linkedQuery,
            { id: identifier },
            queries.linkedSchema,
          )
        ).issue
      : null
    return { teams: viewer.teams, viewer: viewer.id, linked }
  }

  async file(id: string, input: { url: string; entries: string[]; team?: string }) {
    this.connected()
    const { result } = this.find(id, input.url)
    for (const entry of input.entries) {
      const resolved = result.grounding?.resolved?.find((item) => item.id === entry)
      if (!resolved || !triage(resolved).followUp)
        throw new UserError('Choose only findings skipped for a follow-up.')
    }
    const remaining = input.entries.filter(
      (entry) => !result.followUps?.some((ticket) => ticket.entry === entry),
    )
    const failures: { entry: string; message: string }[] = []
    if (remaining.length) {
      const choices = await this.context(id, input.url)
      const team = choices.linked?.team ?? choices.teams.find((item) => item.id === input.team)
      if (!team) throw new UserError('Choose a Linear team for the follow-ups.')
      for (const entry of new Set(remaining)) {
        try {
          await this.filing.load(JSON.stringify([id, input.url, entry]), () =>
            this.create(id, input.url, entry, {
              team: team.id,
              viewer: choices.viewer,
              linked: choices.linked,
            }),
          )
        } catch (error) {
          failures.push({
            entry,
            message: publicError(error, 'Linear could not file this follow-up. Retry in a moment.'),
          })
        }
      }
    }
    return { session: this.find(id, input.url).session, failures }
  }

  private async create(
    id: string,
    url: string,
    entryId: string,
    target: { team: string; viewer: string; linked: FollowUpOptions['linked'] },
  ) {
    const { session, result } = this.find(id, url)
    const existing = result.followUps?.find((ticket) => ticket.entry === entryId)
    if (existing) return existing
    const entry = result.grounding?.resolved?.find((item) => item.id === entryId)
    if (!entry || !triage(entry).followUp)
      throw new UserError('This finding is no longer a follow-up.')
    const content = followUpContent(session, result, entry)
    const description = target.linked
      ? content.description.replace(
          '\n\n+++ Agent notes',
          `\n\nRelated ticket: [${target.linked.identifier}](${target.linked.url})\n\n+++ Agent notes`,
        )
      : content.description
    const { issueCreate } = await this.options.linear.request(
      queries.createMutation,
      {
        input: {
          title: content.title,
          description,
          teamId: target.team,
          assigneeId: target.viewer,
        },
      },
      queries.createSchema,
      { mutation: true },
    )
    if (!issueCreate.success || !issueCreate.issue)
      throw new UserError('Linear did not create this follow-up. Retry in a moment.')
    const ticket = {
      entry: entryId,
      identifier: issueCreate.issue.identifier,
      url: issueCreate.issue.url,
      filedAt: new Date().toISOString(),
    }
    const latest = this.find(id, url)
    latest.result.followUps = [...(latest.result.followUps ?? []), ticket]
    this.options.store.save(latest.session)
    this.options.sessions?.sync('panel', latest.session)
    if (target.linked) await this.relate(issueCreate.issue.id, target.linked.id)
    return ticket
  }

  private async relate(issueId: string, relatedIssueId: string) {
    try {
      const reply = await this.options.linear.request(
        queries.relateMutation,
        { input: { issueId, relatedIssueId, type: 'related' } },
        queries.relateSchema,
        { mutation: true },
      )
      if (!reply.issueRelationCreate.success) throw new Error('Relation was not saved.')
    } catch (error) {
      // The description already links the ticket, so the relation is a convenience.
      logError('Relating a follow-up to its ticket in Linear', error)
    }
  }

  private async viewer() {
    const teams: FollowUpOptions['teams'] = []
    let after: string | null = null
    let id: string
    do {
      const reply: z.infer<typeof queries.viewerSchema> = await this.options.linear.request(
        queries.viewerQuery,
        { after },
        queries.viewerSchema,
      )
      id = reply.viewer.id
      teams.push(...reply.viewer.teams.nodes)
      after = reply.viewer.teams.pageInfo.hasNextPage ? reply.viewer.teams.pageInfo.endCursor : null
    } while (after)
    return { id, teams }
  }

  private connected() {
    if (!this.options.linear.configured())
      throw new UserError('Connect Linear in Settings to file follow-ups.')
  }

  private find(id: string, url: string): { session: PanelSession; result: PanelResult } {
    const session = this.options.store.get(id)
    if (!session) throw new UserError('This panel review is no longer available.', 404)
    if (session.status === 'running')
      throw new UserError('Wait for the panel to finish before filing follow-ups.')
    const result = session.results.find((item) => item.pull.url === url)
    if (!result?.grounding?.resolved) throw new UserError('This PR has no grounded findings.')
    return { session, result }
  }
}
