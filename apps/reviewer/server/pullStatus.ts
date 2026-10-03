import { z } from 'zod'
import { parsePullUrl } from '../shared/pullUrl'
import {
  classifyReadiness,
  type PullCheck,
  type PullReviewer,
  type PullStatus,
} from '../shared/pullStatus'
import { runCommand } from './process'

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() })
const actor = z
  .object({ login: z.string(), avatarUrl: z.string().optional(), url: z.string().optional() })
  .nullable()
const protection = z
  .object({
    requiredApprovingReviewCount: z.number(),
    requiresApprovingReviews: z.boolean(),
    requiresCodeOwnerReviews: z.boolean(),
    requiredStatusCheckContexts: z.array(z.string()),
  })
  .nullable()
const ruleSchema = z.object({
  type: z.string(),
  repositoryRuleset: z.object({ enforcement: z.string() }).nullable(),
  parameters: z
    .object({
      __typename: z.string(),
      requiredApprovingReviewCount: z.number().optional(),
      requireCodeOwnerReview: z.boolean().optional(),
      requiredStatusChecks: z.array(z.object({ context: z.string() })).optional(),
    })
    .nullable(),
})
const ref = z
  .object({
    name: z.string(),
    branchProtectionRule: protection,
    rules: z.object({ nodes: z.array(ruleSchema.nullable()), pageInfo }).optional(),
  })
  .nullable()
const checkNode = z.object({
  __typename: z.string(),
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  required: z.boolean().optional(),
})
const threadsSchema = z.object({
  nodes: z.array(
    z
      .object({
        id: z.string().optional(),
        isResolved: z.boolean(),
        isOutdated: z.boolean().optional(),
        path: z.string().optional(),
        line: z.number().nullable().optional(),
        originalLine: z.number().nullable().optional(),
        comments: z
          .object({
            nodes: z.array(
              z.object({ body: z.string(), url: z.string(), author: actor }).nullable(),
            ),
          })
          .optional(),
      })
      .nullable(),
  ),
  pageInfo,
})
const statusSchema = z.object({
  reviewThreads: threadsSchema.optional(),
  number: z.number(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  mergeStateStatus: z.string(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  baseRef: ref,
  stack: z.object({ baseRefName: z.string() }).nullable().optional(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({
              state: z.string(),
              contexts: z.object({ nodes: z.array(checkNode.nullable()), pageInfo }),
            })
            .nullable(),
        }),
      }),
    ),
  }),
  latestReviews: z.object({
    nodes: z.array(z.object({ author: actor, state: z.string() }).nullable()),
    pageInfo,
  }),
  reviewRequests: z.object({
    nodes: z.array(
      z
        .object({
          requestedReviewer: z
            .object({
              __typename: z.string(),
              login: z.string().optional(),
              slug: z.string().optional(),
              avatarUrl: z.string().optional(),
              url: z.string().optional(),
              organization: z.object({ login: z.string() }).optional(),
            })
            .nullable(),
        })
        .nullable(),
    ),
    pageInfo,
  }),
})
const refRulesFields = `rules(first:100) { pageInfo{hasNextPage endCursor} nodes {type repositoryRuleset{enforcement} parameters {__typename
  ... on PullRequestParameters {requiredApprovingReviewCount requireCodeOwnerReview}
  ... on RequiredStatusChecksParameters {requiredStatusChecks{context}}
}}}`
const protectionFields =
  'requiredApprovingReviewCount requiresApprovingReviews requiresCodeOwnerReviews requiredStatusCheckContexts'
function fields(number?: number): string {
  const required = number == null ? '' : `required:isRequired(pullRequestNumber:${number})`
  return `number headRefOid baseRefOid state isDraft mergeStateStatus mergeable reviewDecision
    stack { baseRefName }
    baseRef { name branchProtectionRule { ${protectionFields} } ${refRulesFields} }
    commits(last:1) { nodes { commit { statusCheckRollup { state contexts(first:100) {
      pageInfo {hasNextPage endCursor} nodes { __typename
      ... on CheckRun {name status conclusion detailsUrl ${required}}
      ... on StatusContext {context state targetUrl ${required}} }
    } } } } }
    reviewThreads(first:100) { pageInfo{hasNextPage endCursor} nodes {id isResolved isOutdated path line originalLine comments(first:1){nodes{body url author{login}}}} }
    latestReviews(first:100) { pageInfo {hasNextPage endCursor} nodes {state author {login avatarUrl url}} }
    reviewRequests(first:100) {pageInfo {hasNextPage endCursor} nodes {requestedReviewer { __typename
      ... on User {login avatarUrl url} ... on Team {slug avatarUrl url organization {login}} ... on Mannequin {login avatarUrl url}
    }}}`
}
const defaultRefFields = `defaultBranchRef {name branchProtectionRule {${protectionFields}} ${refRulesFields}}`

export function normalizePullStatus(value: unknown, defaultBranch: unknown = null): PullStatus {
  const pull = statusSchema.parse(value)
  const defaultRef = ref.parse(defaultBranch)
  const effectiveBase = pull.stack?.baseRefName ?? pull.baseRef?.name
  const effectiveRef =
    effectiveBase === defaultRef?.name
      ? defaultRef
      : effectiveBase === pull.baseRef?.name
        ? pull.baseRef
        : null
  const rule = effectiveRef?.branchProtectionRule
  const activeRules =
    effectiveRef?.rules?.nodes.filter(
      (entry) => entry?.repositoryRuleset?.enforcement === 'ACTIVE',
    ) ?? []
  const requiredApprovals = [
    ...activeRules
      .filter((entry) => entry?.parameters?.__typename === 'PullRequestParameters')
      .map((entry) => entry!.parameters!.requiredApprovingReviewCount ?? 0),
  ]
  if (rule)
    requiredApprovals.push(rule.requiresApprovingReviews ? rule.requiredApprovingReviewCount : 0)
  const rulesKnown = effectiveRef?.rules != null && !effectiveRef.rules.pageInfo.hasNextPage
  const codeOwnersRequired = Boolean(
    rule?.requiresCodeOwnerReviews ||
    activeRules.some((entry) => entry?.parameters?.requireCodeOwnerReview),
  )
  const requiredContexts = new Set([
    ...(rule?.requiredStatusCheckContexts ?? []),
    ...activeRules.flatMap(
      (entry) => entry?.parameters?.requiredStatusChecks?.map((check) => check.context) ?? [],
    ),
  ])
  const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup
  const warnings: string[] = []
  if (effectiveRef?.rules?.pageInfo.hasNextPage)
    warnings.push('Some branch rules are unavailable; GitHub’s merge state remains authoritative.')
  if (rollup?.contexts.pageInfo.hasNextPage)
    warnings.push(
      'The check list exceeds 100 entries; GitHub’s aggregate check state still covers all checks.',
    )
  if (pull.latestReviews.pageInfo.hasNextPage || pull.reviewRequests.pageInfo.hasNextPage)
    warnings.push(
      'The reviewer list exceeds 100 entries; GitHub’s review decision still covers required reviews.',
    )
  const checks: PullCheck[] = (rollup?.contexts.nodes ?? [])
    .filter((node) => node != null)
    .map((node) => {
      const isCheck = node.__typename === 'CheckRun'
      const name = node.name ?? node.context ?? 'Check'
      const state = isCheck ? node.status : node.state
      return {
        name,
        kind: isCheck ? 'check' : 'status',
        status: isCheck
          ? state === 'COMPLETED'
            ? 'completed'
            : state === 'IN_PROGRESS'
              ? 'in-progress'
              : 'queued'
          : state === 'PENDING' || state === 'EXPECTED'
            ? 'in-progress'
            : 'completed',
        conclusion: isCheck ? (node.conclusion ?? null) : (state ?? null),
        url: node.detailsUrl ?? node.targetUrl ?? undefined,
        required: node.required ?? (requiredContexts.has(name) ? true : undefined),
      }
    })
  const reviewers = new Map<string, PullReviewer>()
  const states: Record<string, PullReviewer['state']> = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes-requested',
    COMMENTED: 'commented',
    DISMISSED: 'dismissed',
    PENDING: 'pending',
  }
  for (const review of pull.latestReviews.nodes)
    if (review?.author)
      reviewers.set(`user:${review.author.login}`, {
        ...review.author,
        type: 'user',
        state: states[review.state] ?? 'commented',
      })
  for (const request of pull.reviewRequests.nodes)
    if (request?.requestedReviewer) {
      const reviewer = request.requestedReviewer
      const type = reviewer.__typename === 'Team' ? 'team' : 'user'
      const login =
        reviewer.login ?? `${reviewer.organization?.login ?? ''}/${reviewer.slug ?? 'team'}`
      reviewers.set(`${type}:${login}`, {
        login,
        type,
        state: 'requested',
        avatarUrl: reviewer.avatarUrl,
        url: reviewer.url,
      })
    }
  if (pull.reviewThreads?.pageInfo.hasNextPage)
    warnings.push(
      'The review discussion list exceeds 100 threads; its unresolved total is unknown.',
    )
  const unresolvedThreads = (pull.reviewThreads?.nodes ?? [])
    .filter((thread) => thread && !thread.isResolved)
    .map((thread) => {
      const first = thread!.comments?.nodes.find((comment) => comment != null)
      return {
        id: thread!.id ?? '',
        path: thread!.path ?? '',
        line: thread!.line ?? null,
        originalLine: thread!.originalLine ?? null,
        outdated: thread!.isOutdated ?? false,
        url: first?.url,
        author: first?.author?.login,
        body: first?.body.slice(0, 300) ?? '',
      }
    })
  const status = {
    detailLevel: 'full' as const,
    unresolvedReviewThreads:
      pull.reviewThreads && !pull.reviewThreads.pageInfo.hasNextPage
        ? unresolvedThreads.length
        : null,
    unresolvedThreads,
    headSha: pull.headRefOid,
    baseSha: pull.baseRefOid,
    state: pull.state.toLowerCase() as PullStatus['state'],
    isDraft: pull.isDraft,
    mergeState: pull.mergeStateStatus,
    mergeable: pull.mergeable,
    reviewDecision: pull.reviewDecision,
    requiredApprovals:
      requiredApprovals.length > 0
        ? Math.max(0, ...requiredApprovals)
        : rulesKnown && pull.reviewDecision == null
          ? 0
          : null,
    requiresCodeOwnerReviews:
      requiredApprovals.length > 0 || (rulesKnown && pull.reviewDecision == null)
        ? codeOwnersRequired
        : null,
    requirementsKnown: requiredApprovals.length > 0 || (rulesKnown && pull.reviewDecision == null),
    checksState: rollup?.state ?? null,
    checks,
    reviewers: [...reviewers.values()],
    warnings,
  }
  return { ...status, ...classifyReadiness(status) }
}

async function graphql(
  query: string,
  variables: Record<string, unknown>,
  paginate = false,
): Promise<unknown> {
  const output = await runCommand({
    command: 'gh',
    // gh cannot paginate a raw --input body; field arguments let it update endCursor safely.
    args: paginate
      ? [
          'api',
          'graphql',
          '--paginate',
          '--slurp',
          '-f',
          `query=${query}`,
          ...Object.entries(variables).flatMap(([name, value]) => [
            '-f',
            `${name}=${String(value)}`,
          ]),
        ]
      : ['api', 'graphql', '--input', '-'],
    input: paginate ? undefined : JSON.stringify({ query, variables }),
  })
  return JSON.parse(output)
}
function data(value: unknown): Record<string, unknown> {
  const response = z
    .object({
      data: z.record(z.string(), z.unknown()).nullable().optional(),
      errors: z.array(z.object({ message: z.string() })).optional(),
    })
    .parse(value)
  if (response.errors?.length || !response.data)
    throw new Error(
      response.errors?.map((error) => error.message).join('; ') ??
        'GitHub status metadata is unavailable.',
    )
  return response.data
}
const cached = new Map<string, { expires: number; status: PullStatus }>()
function remember(repository: string, number: number, status: PullStatus) {
  cached.set(`${repository.toLowerCase()}#${number}`, { expires: Date.now() + 10_000, status })
  if (cached.size > 1000) cached.delete(cached.keys().next().value!)
}

const inboxStatusSchema = statusSchema
  .omit({ baseRef: true, commits: true, latestReviews: true, reviewRequests: true })
  .extend({
    baseRef: z.object({ name: z.string() }).nullable(),
    commits: z.object({
      nodes: z.array(
        z.object({
          commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullable() }),
        }),
      ),
    }),
  })
function normalizeInboxStatus(value: unknown): PullStatus {
  const pull = inboxStatusSchema.parse(value)
  const full = normalizePullStatus({
    ...pull,
    baseRef: pull.baseRef ? { ...pull.baseRef, branchProtectionRule: null } : null,
    commits: {
      nodes: pull.commits.nodes.map(({ commit }) => ({
        commit: {
          statusCheckRollup: commit.statusCheckRollup
            ? {
                ...commit.statusCheckRollup,
                contexts: { nodes: [], pageInfo: { hasNextPage: false } },
              }
            : null,
        },
      })),
    },
    latestReviews: { nodes: [], pageInfo: { hasNextPage: false } },
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } },
  })
  return { ...full, detailLevel: 'summary', unresolvedThreads: [] }
}

/** A single paginated GraphQL CLI call reads status for the repository's entire open inbox. */
async function readInboxStatuses(repository: string): Promise<Map<number, PullStatus>> {
  const [owner, name] = repository.split('/')
  const query = `query($owner:String!,$name:String!,$endCursor:String) { repository(owner:$owner,name:$name) {
    pullRequests(first:50,states:OPEN,after:$endCursor,orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo {hasNextPage endCursor} nodes {
      number headRefOid baseRefOid state isDraft mergeStateStatus mergeable reviewDecision stack{baseRefName} baseRef{name}
      commits(last:1){nodes{commit{statusCheckRollup{state}}}}
    } }
  } }`
  const values = z.array(z.unknown()).parse(await graphql(query, { owner, name }, true))
  const statuses = new Map<number, PullStatus>()
  for (const page of values) {
    const repo = z
      .object({
        pullRequests: z.object({ nodes: z.array(z.unknown()), pageInfo }),
      })
      .parse(data(page).repository)
    for (const value of repo.pullRequests.nodes) {
      const number = z.object({ number: z.number() }).parse(value).number
      const status = normalizeInboxStatus(value)
      statuses.set(number, status)
    }
  }
  return statuses
}

/** My PRs load full discussion and reviewer details for the authenticated author's subset. */
async function readOwnedInboxStatuses(
  repository: string,
  refresh: boolean,
): Promise<Map<number, PullStatus>> {
  const [userOutput, pullsOutput] = await Promise.all([
    runCommand({ command: 'gh', args: ['api', 'user'] }),
    runCommand({
      command: 'gh',
      args: ['api', `repos/${repository}/pulls?state=open&per_page=100`, '--paginate', '--slurp'],
    }),
  ])
  const viewer = z.object({ login: z.string().min(1) }).parse(JSON.parse(userOutput)).login
  const pages = z
    .array(
      z.array(
        z.object({ number: z.number().int().positive(), user: z.object({ login: z.string() }) }),
      ),
    )
    .parse(JSON.parse(pullsOutput))
  const numbers = pages
    .flat()
    .filter((pull) => pull.user.login.toLowerCase() === viewer.toLowerCase())
    .map((pull) => pull.number)
  return fetchPullStatuses(repository, numbers, refresh)
}

const pendingInboxes = new Map<string, Promise<Map<number, PullStatus>>>()
const inboxCache = new Map<string, { expires: number; statuses: Map<number, PullStatus> }>()
/** Concurrent tabs share the active bulk read without delaying the core inbox response. */
export function fetchInboxStatuses(
  repository: string,
  refresh = false,
  filter: 'all' | 'mine' = 'all',
): Promise<Map<number, PullStatus>> {
  const key = `${repository.toLowerCase()}#${filter}`
  const existing = pendingInboxes.get(key)
  if (existing) return existing
  const cached = inboxCache.get(key)
  if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.statuses)
  const request = (
    filter === 'mine' ? readOwnedInboxStatuses(repository, refresh) : readInboxStatuses(repository)
  )
    .then((statuses) => {
      inboxCache.set(key, { expires: Date.now() + 15_000, statuses })
      if (inboxCache.size > 30) inboxCache.delete(inboxCache.keys().next().value!)
      return statuses
    })
    .finally(() => {
      pendingInboxes.delete(key)
    })
  pendingInboxes.set(key, request)
  return request
}

/** Stack layers share one aliased query; no CLI process is launched per layer. */
export async function fetchPullStatuses(
  repository: string,
  numbers: number[],
  refresh = false,
): Promise<Map<number, PullStatus>> {
  const unique = [...new Set(numbers)]
  const statuses = new Map<number, PullStatus>()
  const missing = unique.filter((number) => {
    const entry = cached.get(`${repository.toLowerCase()}#${number}`)
    if (!refresh && entry && entry.expires > Date.now()) {
      statuses.set(number, entry.status)
      return false
    }
    return true
  })
  const [owner, name] = repository.split('/')
  // A batch of 40 PRs keeps nested connection limits below GitHub's query node budget.
  for (let offset = 0; offset < missing.length; offset += 40) {
    const batch = missing.slice(offset, offset + 40)
    const query = `query($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { ${defaultRefFields}
      ${batch.map((number) => `pr${number}:pullRequest(number:${number}) {${fields(number)}}`).join('\n')}
    } }`
    const repo = z
      .record(z.string(), z.unknown())
      .parse(data(await graphql(query, { owner, name })).repository)
    for (const number of batch) {
      const status = normalizePullStatus(repo[`pr${number}`], repo.defaultBranchRef)
      statuses.set(number, status)
      remember(repository, number, status)
    }
  }
  return statuses
}
export async function fetchPullStatus(url: string, refresh = false): Promise<PullStatus> {
  const { owner, repo, number } = parsePullUrl(url)
  const statuses = await fetchPullStatuses(`${owner}/${repo}`, [number], refresh)
  return statuses.get(number)!
}
export function clearPullStatusCache(): void {
  cached.clear()
  pendingInboxes.clear()
  inboxCache.clear()
}
