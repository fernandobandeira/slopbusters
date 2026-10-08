import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { Ticket } from '../../../shared/domain/tickets'
import type { GitHub } from '../../adapters/github'
import { logError } from '../../errors'
import {
  MAX_REVIEW_SNAPSHOT_CHARACTERS,
  MAX_TICKET_CONTEXT_CHARACTERS,
  MAX_TICKET_RELATIVE_CHARACTERS,
} from '../../limits'
import { clip } from '../tickets/tickets'

const pullBody = z.object({ body: z.string().nullable(), head: z.object({ ref: z.string() }) })
const pullFile = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
})
const MAX_EVIDENCE_FILES = 300

/** Everything Jobs reads about a ticket: the issue, its family, and what its PRs say and touch. */
export async function ticketEvidence(
  github: GitHub,
  ticket: Ticket,
  signal?: AbortSignal,
): Promise<string> {
  const pulls = await Promise.all(ticket.pulls.map((pull) => pullEvidence(github, pull, signal)))
  const evidence = JSON.stringify({
    ticket: {
      identifier: ticket.identifier,
      title: ticket.title,
      url: ticket.url,
      state: ticket.state.name,
      team: ticket.team.name,
      project: ticket.project,
      assignee: ticket.assignee,
      labels: ticket.labels,
      branchName: ticket.branchName,
      description: ticket.description,
    },
    parent: ticket.parentTicket && {
      identifier: ticket.parentTicket.identifier,
      title: ticket.parentTicket.title,
      state: ticket.parentTicket.state.name,
      description: clip(ticket.parentTicket.description, MAX_TICKET_CONTEXT_CHARACTERS),
    },
    children: ticket.children.map((child) => ({
      identifier: child.identifier,
      title: child.title,
      state: child.state.name,
      pullUrls: child.pullUrls,
    })),
    linkedPulls: pulls,
  })
  if (evidence.length > MAX_REVIEW_SNAPSHOT_CHARACTERS)
    throw new Error(
      'This ticket and its linked PRs exceed Jobs’s review limit. Shorten the ticket or review it in parts.',
    )
  return evidence
}

async function pullEvidence(github: GitHub, pull: Ticket['pulls'][number], signal?: AbortSignal) {
  const { owner, repo, number } = parsePullUrl(pull.url)
  const endpoint = `repos/${owner}/${repo}/pulls/${String(number)}`
  try {
    const [details, files] = await Promise.all([
      github.rest(endpoint, { signal }).then((value) => pullBody.parse(value)),
      github
        .paginate(`${endpoint}/files?per_page=100`, { signal })
        .then((value) => z.array(pullFile).parse(value)),
    ])
    return {
      url: pull.url,
      title: pull.title,
      state: pull.state,
      branch: details.head.ref,
      description: clip(details.body ?? '', MAX_TICKET_RELATIVE_CHARACTERS),
      files: files.slice(0, MAX_EVIDENCE_FILES).map((file) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
      filesTruncated: files.length > MAX_EVIDENCE_FILES,
    }
  } catch (error) {
    signal?.throwIfAborted()
    logError(`Loading evidence for ${pull.url}`, error)
    return { url: pull.url, title: pull.title, state: pull.state, unavailable: true }
  }
}
