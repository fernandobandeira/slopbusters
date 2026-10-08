import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import { ticketIdentifierIn } from '../../../shared/domain/tickets'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitHub } from '../../adapters/github'
import { LinearError, type Linear } from '../../adapters/linear'
import { createCache } from '../../cache'
import { logError } from '../../errors'
import { MAX_TICKET_CACHE_ENTRIES, TICKET_LINK_TTL_MS } from '../../limits'
import * as queries from './linearQueries'

type PullIdentity = Pick<PullRequest, 'url' | 'headBranch' | 'title'>

/** Find the issue a PR implements: Linear's own PR link, then the branch, then the title. */
export function createTicketLinks(linear: Linear, github: GitHub) {
  const links = createCache<string | null>({
    max: MAX_TICKET_CACHE_ENTRIES,
    ttlMs: TICKET_LINK_TTL_MS,
  })
  async function byAttachment(url: string, signal?: AbortSignal) {
    const result = await linear.request(
      queries.ticketByAttachmentQuery,
      { url },
      queries.ticketByAttachmentSchema,
      { signal },
    )
    return result.attachmentsForURL.nodes.find((node) => node.issue)?.issue?.identifier
  }
  async function byBranch(branch: string, signal?: AbortSignal) {
    if (!branch) return undefined
    const result = await linear.request(
      queries.ticketByBranchQuery,
      { branch },
      queries.ticketByBranchSchema,
      { signal },
    )
    return result.issueVcsBranchSearch?.identifier
  }
  function forPull(pull: PullIdentity, signal?: AbortSignal) {
    return links.load(pull.url, async () => {
      for (const find of [
        () => byAttachment(pull.url, signal),
        () => byBranch(pull.headBranch, signal),
      ]) {
        try {
          const identifier = await find()
          if (identifier) return identifier
        } catch (error) {
          if (error instanceof LinearError && error.kind !== 'invalid') throw error
          logError('Finding the Linear issue for a PR', error)
        }
      }
      const named =
        ticketIdentifierIn(pull.title) ?? ticketIdentifierIn(pull.headBranch, { ignoreCase: true })
      return named ? confirm(named, signal) : null
    })
  }
  /** A key-shaped word such as UTF-8 is only a ticket if Linear has it. */
  async function confirm(identifier: string, signal?: AbortSignal) {
    try {
      const result = await linear.request(
        queries.ticketExistsQuery,
        { id: identifier },
        queries.ticketExistsSchema,
        { signal },
      )
      return result.issue.identifier
    } catch (error) {
      if (error instanceof LinearError && error.kind === 'not-found') return null
      throw error
    }
  }
  async function forPullUrl(url: string) {
    const { owner, repo, number } = parsePullUrl(url)
    const pull = z
      .object({ title: z.string(), head: z.object({ ref: z.string() }) })
      .parse(await github.rest(`repos/${owner}/${repo}/pulls/${String(number)}`))
    return forPull({ url, title: pull.title, headBranch: pull.head.ref })
  }
  return { forPull, forPullUrl }
}
