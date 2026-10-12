import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import {
  ticketFinished,
  type TicketProgress,
  type TicketReference,
  type TicketSummary,
  type TicketView,
} from '../../../shared/domain/tickets'

const state = z.object({ name: z.string(), type: z.string(), color: z.string() })
const urls = z.object({ nodes: z.array(z.object({ url: z.string() })) })
const reference = z.object({ identifier: z.string(), title: z.string(), url: z.string(), state })
const childStates = z.object({
  nodes: z.array(z.object({ state: z.object({ type: z.string() }) })),
})
const relations = z.object({
  nodes: z.array(z.object({ type: z.string(), relatedIssue: reference })),
})
const inverseRelations = z.object({
  nodes: z.array(z.object({ type: z.string(), issue: reference })),
})
const summaryNode = z.object({
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  priority: z.number(),
  updatedAt: z.string(),
  subIssueSortOrder: z.number().nullable(),
  state,
  assignee: z.object({ name: z.string() }).nullable(),
  team: z.object({ key: z.string(), name: z.string() }),
  project: z.object({ name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }),
  parent: reference.extend({ children: childStates }).nullable(),
  children: childStates,
  relations,
  inverseRelations,
  attachments: urls,
})
const referenceFields = 'identifier title url state { name type color }'
const relationFields = `relations(first: 20) { nodes { type relatedIssue { ${referenceFields} } } }
  inverseRelations(first: 20) { nodes { type issue { ${referenceFields} } } }`
const childStateFields = 'children(first: 50) { nodes { state { type } } }'
const summaryFields = `identifier title url priority updatedAt subIssueSortOrder
  state { name type color } assignee { name } team { key name } project { name }
  labels(first: 20) { nodes { name color } }
  parent { ${referenceFields} ${childStateFields} } ${childStateFields}
  ${relationFields}
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
    parentTicket: parent { ${referenceFields} description }
    subIssues: children(first: 100) {
      nodes { ${referenceFields} subIssueSortOrder ${relationFields} attachments(first: 25) { nodes { url } } }
    }
  }
}`
export const ticketSchema = z.object({
  issue: summaryNode.extend({
    id: z.string(),
    description: z.string().nullable(),
    branchName: z.string(),
    parentTicket: reference.extend({ description: z.string().nullable() }).nullable(),
    subIssues: z.object({
      nodes: z.array(
        reference.extend({
          subIssueSortOrder: z.number().nullable(),
          relations,
          inverseRelations,
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
    labels: node.labels.nodes,
    parent: node.parent && {
      ...reference.parse(node.parent),
      progress: progress(node.parent.children),
    },
    sortOrder: node.subIssueSortOrder ?? 0,
    progress: progress(node.children),
    ...blockers(node),
    pullUrls: pullUrls(node.attachments),
  }
}

/** The unfinished issues on either side of this issue's "blocks" relations. */
export function blockers(node: {
  relations: z.infer<typeof relations>
  inverseRelations: z.infer<typeof inverseRelations>
}): { blockedBy: TicketReference[]; blocking: TicketReference[] } {
  return {
    blockedBy: node.inverseRelations.nodes
      .filter((relation) => relation.type === 'blocks' && !ticketFinished(relation.issue.state))
      .map((relation) => relation.issue),
    blocking: node.relations.nodes
      .filter(
        (relation) => relation.type === 'blocks' && !ticketFinished(relation.relatedIssue.state),
      )
      .map((relation) => relation.relatedIssue),
  }
}

function progress(children: z.infer<typeof childStates>): TicketProgress {
  return {
    done: children.nodes.filter((child) => ticketFinished(child.state)).length,
    total: children.nodes.length,
  }
}
