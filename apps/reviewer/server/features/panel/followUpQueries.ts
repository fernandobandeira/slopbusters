import { z } from 'zod'
import { followUpTeamSchema } from '../../../shared/domain/panelFollowups'

// Verified against linear/linear packages/sdk/src/schema.graphql (IssueCreateInput,
// IssueRelationCreateInput, Mutation, User.teams and IssuePayload).
export const viewerQuery = `query SlopbustersFollowUpViewer($after: String) {
  viewer { id teams(first: 100, after: $after) {
    nodes { id name key } pageInfo { hasNextPage endCursor }
  } }
}`
export const viewerSchema = z.object({
  viewer: z.object({
    id: z.string(),
    teams: z.object({
      nodes: z.array(followUpTeamSchema),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    }),
  }),
})
export const linkedQuery = `query SlopbustersFollowUpLink($id: String!) {
  issue(id: $id) { id identifier url team { id name key } }
}`
export const linkedSchema = z.object({
  issue: z.object({
    id: z.string(),
    identifier: z.string(),
    url: z.string(),
    team: followUpTeamSchema,
  }),
})
export const createMutation = `mutation SlopbustersFollowUp($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`
export const createSchema = z.object({
  issueCreate: z.object({
    success: z.boolean(),
    issue: z.object({ id: z.string(), identifier: z.string(), url: z.string() }).nullable(),
  }),
})
export const relateMutation = `mutation SlopbustersRelateFollowUp($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) { success }
}`
export const relateSchema = z.object({
  issueRelationCreate: z.object({ success: z.boolean() }),
})
