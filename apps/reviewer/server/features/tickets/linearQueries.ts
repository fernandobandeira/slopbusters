import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import type { TicketSummary, TicketView } from '../../../shared/domain/tickets'

const state = z.object({ name: z.string(), type: z.string() })
const urls = z.object({ nodes: z.array(z.object({ url: z.string() })) })
const summaryNode = z.object({
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  priority: z.number(),
  updatedAt: z.string(),
  state,
  assignee: z.object({ name: z.string() }).nullable(),
  team: z.object({ key: z.string(), name: z.string() }),
  project: z.object({ name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  parent: z.object({ identifier: z.string() }).nullable(),
  attachments: urls,
})
const summaryFields = `identifier title url priority updatedAt
  state { name type } assignee { name } team { key name } project { name }
  labels(first: 20) { nodes { name } } parent { identifier }
  attachments(first: 25) { nodes { url } }`

export const ticketListQuery = `query SlopbustersTickets($filter: IssueFilter, $after: String) {
  issues(filter: $filter, first: 50, after: $after, orderBy: updatedAt) {
    nodes { ${summaryFields} }
    pageInfo { hasNextPage endCursor }
  }
}`
export const ticketListSchema = z.object({
  issues: z.object({
    nodes: z.array(summaryNode),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
})

export function ticketFilter(view: TicketView) {
  const person = { isMe: { eq: true } }
  return {
    ...(view === 'assigned' ? { assignee: person } : { creator: person }),
    state: { type: { nin: ['completed', 'canceled'] } },
  }
}

export const ticketQuery = `query SlopbustersTicket($id: String!) {
  issue(id: $id) {
    id description branchName ${summaryFields}
    parentTicket: parent { identifier title url description state { name type } }
    children(first: 100) {
      nodes { identifier title url state { name type } attachments(first: 25) { nodes { url } } }
    }
  }
}`
export const ticketSchema = z.object({
  issue: summaryNode.extend({
    id: z.string(),
    description: z.string().nullable(),
    branchName: z.string(),
    parentTicket: z
      .object({
        identifier: z.string(),
        title: z.string(),
        url: z.string(),
        description: z.string().nullable(),
        state,
      })
      .nullable(),
    children: z.object({
      nodes: z.array(
        z.object({
          identifier: z.string(),
          title: z.string(),
          url: z.string(),
          state,
          attachments: urls,
        }),
      ),
    }),
  }),
})

export const ticketByAttachmentQuery = `query SlopbustersTicketForPull($url: String!) {
  attachmentsForURL(url: $url) { nodes { issue { identifier } } }
}`
export const ticketByAttachmentSchema = z.object({
  attachmentsForURL: z.object({
    nodes: z.array(z.object({ issue: z.object({ identifier: z.string() }).nullable() })),
  }),
})
export const ticketByBranchQuery = `query SlopbustersTicketForBranch($branch: String!) {
  issueVcsBranchSearch(branchName: $branch) { identifier }
}`
export const ticketByBranchSchema = z.object({
  issueVcsBranchSearch: z.object({ identifier: z.string() }).nullable(),
})

export const ticketExistsQuery = `query SlopbustersTicketExists($id: String!) {
  issue(id: $id) { identifier }
}`
export const ticketExistsSchema = z.object({ issue: z.object({ identifier: z.string() }) })

export const updateTicketMutation = `mutation SlopbustersUpdateTicket($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`
export const updateTicketSchema = z.object({ issueUpdate: z.object({ success: z.boolean() }) })

export const viewerQuery = 'query SlopbustersViewer { viewer { name email } }'
export const viewerSchema = z.object({ viewer: z.object({ name: z.string(), email: z.string() }) })

export function pullUrls(attachments: z.infer<typeof urls>): string[] {
  return [
    ...new Set(
      attachments.nodes
        .map((node) => node.url)
        .filter((url) => {
          try {
            parsePullUrl(url)
            return true
          } catch {
            return false
          }
        }),
    ),
  ]
}

export function ticketSummary(node: z.infer<typeof summaryNode>): TicketSummary {
  return {
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: node.state,
    priority: node.priority,
    updatedAt: node.updatedAt,
    assignee: node.assignee?.name ?? null,
    team: node.team,
    project: node.project?.name ?? null,
    labels: node.labels.nodes.map((label) => label.name),
    parent: node.parent?.identifier ?? null,
    pullUrls: pullUrls(node.attachments),
  }
}
