import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { Ticket, TicketPull } from '../../../shared/domain/tickets'
import type { GitHub } from '../../adapters/github'
import type { Linear } from '../../adapters/linear'
import { logError } from '../../errors'
import * as queries from './linearQueries'

const githubPull = z.object({
  title: z.string(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
})

/** One issue with its parent, children, and the current state of every linked PR. */
export async function downloadTicket(
  services: { linear: Linear; github: GitHub },
  identifier: string,
  signal?: AbortSignal,
): Promise<Ticket> {
  const { issue } = await services.linear.request(
    queries.ticketQuery,
    { id: identifier },
    queries.ticketSchema,
    { signal },
  )
  const summary = queries.ticketSummary(issue)
  return {
    ...summary,
    id: issue.id,
    description: issue.description ?? '',
    branchName: issue.branchName,
    parentTicket: issue.parentTicket && {
      ...issue.parentTicket,
      description: issue.parentTicket.description ?? '',
    },
    children: issue.children.nodes.map((child) => ({
      identifier: child.identifier,
      title: child.title,
      url: child.url,
      state: child.state,
      pullUrls: queries.pullUrls(child.attachments),
    })),
    pulls: await Promise.all(
      summary.pullUrls.map((url) => pullState(services.github, url, signal)),
    ),
  }
}

async function pullState(github: GitHub, url: string, signal?: AbortSignal): Promise<TicketPull> {
  const { owner, repo, number } = parsePullUrl(url)
  const base = { url, repository: `${owner}/${repo}`, number }
  try {
    const pull = githubPull.parse(
      await github.rest(`repos/${owner}/${repo}/pulls/${String(number)}`, { signal }),
    )
    return { ...base, title: pull.title, state: pull.merged ? 'merged' : pull.state }
  } catch (error) {
    logError(`Loading linked PR ${url}`, error)
    return { ...base, title: '', state: 'unknown' }
  }
}
