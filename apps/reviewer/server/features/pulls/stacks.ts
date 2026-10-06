import { MAX_REPOSITORY_CACHE_ENTRIES } from '../../limits'
import { z } from 'zod'
import { parsePullUrl } from '../../../shared/domain/pullUrl'
import {
  derivePullStack,
  type BranchPull,
  type PullStack,
  type PullStackResult,
  type PullStackSummary,
} from '../../../shared/domain/stacks'
import { createGitHub, type GitHub } from '../../adapters/github'
import { createCache } from '../../cache'
import { STACK_TTL_MS } from '../../limits'
import { logError } from '../../errors'
import { createPullStatusService } from './pullStatus'

const repositorySchema = z
  .object({ id: z.number().optional(), full_name: z.string().optional() })
  .nullable()
  .optional()
const refSchema = z.object({ ref: z.string(), repo: repositorySchema })
export const stackPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().optional(),
  html_url: z.string().optional(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  head: refSchema,
  base: refSchema.optional(),
})
const nativeStackSchema = z.object({
  id: z.union([z.number(), z.string()]),
  number: z.number().int().positive(),
  base: z.object({ ref: z.string() }),
  pull_requests: z.array(stackPullSchema),
})
export type NativeStack = z.infer<typeof nativeStackSchema>
export function branchPull(value: unknown, repository: string): BranchPull {
  const pull = stackPullSchema.parse(value)
  const identity = (repo: z.infer<typeof repositorySchema>): string | null =>
    repo?.id != null
      ? `id:${repo.id}`
      : repo?.full_name
        ? `name:${repo.full_name.toLowerCase()}`
        : null
  return {
    number: pull.number,
    title: pull.title ?? `Pull request #${pull.number}`,
    url: pull.html_url ?? `https://github.com/${repository}/pull/${pull.number}`,
    repository,
    headBranch: pull.head.ref,
    baseBranch: pull.base?.ref ?? '',
    headRepositoryId: identity(pull.head.repo),
    baseRepositoryId: identity(pull.base?.repo),
    state: pull.merged || pull.merged_at ? 'merged' : pull.state,
    isDraft: pull.draft ?? false,
  }
}

/** REST returns native stack layers in dependency order, including retained closed/merged layers. */
export function nativePullStack(
  value: NativeStack,
  repository: string,
  currentNumber: number,
): PullStackResult {
  const position = value.pull_requests.findIndex((pull) => pull.number === currentNumber) + 1
  if (!position)
    return {
      stack: null,
      incomplete: true,
      warnings: ['GitHub did not include the selected pull request in its stack.'],
    }
  const numbers = value.pull_requests.map((pull) => pull.number)
  if (new Set(numbers).size !== numbers.length)
    return {
      stack: null,
      incomplete: true,
      warnings: ['GitHub returned duplicate stack layers; no safe stack order is available.'],
    }
  const items = value.pull_requests.map((pull, index) => {
    const item = branchPull(pull, repository)
    const { headRepositoryId: _head, baseRepositoryId: _base, ...layer } = item
    return {
      ...layer,
      baseBranch:
        layer.baseBranch ||
        (index === 0 ? value.base.ref : value.pull_requests[index - 1]!.head.ref),
    }
  })
  return {
    stack: {
      id: `github:${repository.toLowerCase()}:${value.number}`,
      number: value.number,
      source: 'github',
      baseBranch: value.base.ref,
      position,
      size: items.length,
      items,
      warnings: [],
    },
    warnings: [],
  }
}

export function inboxStackSummaries(
  repository: string,
  pulls: unknown[],
  native: NativeStack[],
): Map<number, PullStackSummary> {
  const result = new Map<number, PullStackSummary>()
  for (const stack of native)
    for (const pull of stack.pull_requests) {
      const detail = nativePullStack(stack, repository, pull.number).stack
      if (detail) {
        const { items: _items, warnings: _warnings, ...summary } = detail
        result.set(pull.number, summary)
      }
    }
  // A PR resource can expose authoritative membership even when the bulk endpoint is unavailable.
  const membershipSchema = z.object({
    number: z.number(),
    stack: z
      .object({
        number: z.number().int().positive(),
        position: z.number().int().positive(),
        size: z.number().int().positive(),
        base: z.object({ ref: z.string() }),
      })
      .nullable()
      .optional(),
  })
  for (const value of pulls) {
    const parsed = membershipSchema.safeParse(value)
    if (parsed.success && parsed.data.stack) {
      const { stack, number } = parsed.data
      result.set(number, {
        id: `github:${repository.toLowerCase()}:${stack.number}`,
        number: stack.number,
        source: 'github',
        baseBranch: stack.base.ref,
        position: stack.position,
        size: stack.size,
      })
    }
  }
  const branches = pulls.map((pull) => branchPull(pull, repository))
  for (const pull of branches)
    if (!result.has(pull.number)) {
      const derived = derivePullStack(branches, pull.number).stack
      if (derived) {
        const { items: _items, warnings: _warnings, ...summary } = derived
        result.set(pull.number, summary)
      }
    }
  return result
}

export function createStackService(
  github: GitHub = createGitHub(),
  statuses = createPullStatusService(github),
) {
  const cache = createCache<{ stacks: NativeStack[]; warnings: string[] }>({
    max: MAX_REPOSITORY_CACHE_ENTRIES,
    ttlMs: STACK_TTL_MS,
  })
  const fetchPullStatuses = statuses.fetchPullStatuses
  const headers = ['X-GitHub-Api-Version: 2026-03-10', 'Accept: application/vnd.github+json']
  const json = (endpoint: string, paginate = false) =>
    paginate ? github.paginate(endpoint, { headers }) : github.rest(endpoint, { headers })
  function listNativeStacks(repository: string, refresh = false) {
    const key = repository.toLowerCase()
    // Back off briefly after an unavailable bulk endpoint, even during inbox refresh.
    const previous = cache.get(key)
    if (previous?.warnings.length) return Promise.resolve(previous)
    return cache.load(
      key,
      async () => {
        try {
          const value = await json(`repos/${repository}/stacks?per_page=100`, true)
          return { stacks: z.array(nativeStackSchema).parse(value), warnings: [] }
        } catch (error) {
          logError('Loading native stacks', error)
          return {
            stacks: [],
            warnings: [
              'GitHub stack metadata is unavailable. Branch-derived chains are shown where their dependencies are unambiguous.',
            ],
          }
        }
      },
      refresh,
    )
  }
  async function getStackMetadata(url: string, refresh = false): Promise<PullStackResult> {
    const { owner, repo, number } = parsePullUrl(url)
    const repository = `${owner}/${repo}`
    const metadata = stackPullSchema
      .extend({
        stack: z
          .object({
            number: z.number().int().positive(),
            position: z.number().int().positive().optional(),
            size: z.number().int().positive().optional(),
            base: z.object({ ref: z.string() }).optional(),
          })
          .nullable()
          .optional(),
      })
      .parse(await json(`repos/${repository}/pulls/${number}`))
    if (metadata.stack) {
      try {
        const native = nativeStackSchema.parse(
          await json(`repos/${repository}/stacks/${metadata.stack.number}`),
        )
        return nativePullStack(native, repository, number)
      } catch (error) {
        logError('Reading native stack details', error)
        // Membership is authoritative; never replace a known native stack with an incomplete inferred one.
        return {
          stack: null,
          incomplete: true,
          summary:
            metadata.stack.position && metadata.stack.size && metadata.stack.base
              ? {
                  id: `github:${repository.toLowerCase()}:${metadata.stack.number}`,
                  number: metadata.stack.number,
                  source: 'github',
                  position: metadata.stack.position,
                  size: metadata.stack.size,
                  baseBranch: metadata.stack.base.ref,
                }
              : undefined,
          warnings: [
            'GitHub reports a native stack, but its layers could not be loaded. Try refreshing the stack.',
          ],
        }
      }
    }
    const native = await listNativeStacks(repository, refresh)
    const membership = native.stacks.find((stack) =>
      stack.pull_requests.some((pull) => pull.number === number),
    )
    if (membership) {
      try {
        return nativePullStack(
          nativeStackSchema.parse(await json(`repos/${repository}/stacks/${membership.number}`)),
          repository,
          number,
        )
      } catch (error) {
        logError('Reading native stack membership', error)
        return nativePullStack(membership, repository, number)
      }
    }
    const pages = z
      .array(stackPullSchema)
      .parse(await json(`repos/${repository}/pulls?state=open&per_page=100`, true))
      .flat()
    const candidates = pages.filter((pull) => pull.number !== number)
    candidates.push(metadata)
    const inferred = derivePullStack(
      candidates.map((pull) => branchPull(pull, repository)),
      number,
    )
    const warnings = [...native.warnings, ...inferred.warnings]
    if (inferred.stack)
      warnings.push(
        'This chain is inferred from repository-qualified branch targets among open pull requests; it is not a GitHub native stack.',
      )
    const stack: PullStack | null = inferred.stack ? { ...inferred.stack, warnings } : null
    return { stack, warnings, incomplete: inferred.incomplete }
  }

  async function getStackForPull(
    url: string,
    options: { refresh?: boolean } = {},
  ): Promise<PullStackResult> {
    const result = await getStackMetadata(url, options.refresh)
    if (!result.stack) return result
    const stack = result.stack
    try {
      const { owner, repo } = parsePullUrl(url)
      const statuses = await fetchPullStatuses(
        `${owner}/${repo}`,
        stack.items.map((pull) => pull.number),
        options.refresh,
      )
      return {
        ...result,
        stack: {
          ...stack,
          items: stack.items.map((pull) => {
            const status = statuses.get(pull.number)
            return {
              ...pull,
              state: status?.state ?? pull.state,
              isDraft: status?.isDraft ?? pull.isDraft,
              status,
            }
          }),
        },
      }
    } catch (error) {
      logError('Reading stack status', error)
      const warnings = [
        ...result.warnings,
        'GitHub CI and review metadata is unavailable. Refresh the stack to retry.',
      ]
      return { ...result, warnings, stack: { ...stack, warnings } }
    }
  }

  return { listNativeStacks, getStackForPull, getStackMetadata }
}
