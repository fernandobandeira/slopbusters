import { z } from 'zod'
import { runCommand } from './process'
import { retryNetwork } from './network'

export interface GitHubOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: string[]
  jq?: string
  raw?: boolean
  /** CI logs contain color codes, which gh refuses to print without this flag. */
  allowEscapeSequences?: boolean
  maxOutputBytes?: number
  timeoutMs?: number
  signal?: AbortSignal
}
export interface GitHub {
  rest(this: void, endpoint: string, options?: GitHubOptions): Promise<unknown>
  paginate(this: void, endpoint: string, options?: GitHubOptions): Promise<unknown[]>
  graphql(
    this: void,
    query: string,
    variables: Record<string, unknown>,
    paginate?: boolean,
    options?: GitHubOptions,
  ): Promise<unknown>
}

const envelope = z.object({ errors: z.array(z.object({ message: z.string() })).optional() })

export function createGitHub(runner = runCommand, retryDelaysMs?: readonly number[]): GitHub {
  async function request(
    endpoint: string,
    options: GitHubOptions = {},
    extra: string[] = [],
    idempotent = !options.method || options.method === 'GET',
  ) {
    const run = () =>
      runner({
        command: 'gh',
        args: [
          'api',
          endpoint,
          ...(options.headers ?? []).flatMap((header) => ['-H', header]),
          ...(options.method ? ['--method', options.method] : []),
          ...(options.body === undefined ? [] : ['--input', '-']),
          ...(options.jq ? ['--jq', options.jq] : []),
          ...(options.allowEscapeSequences ? ['--allow-escape-sequences'] : []),
          ...extra,
        ],
        input: options.body === undefined ? undefined : JSON.stringify(options.body),
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      })
    const output = await retryNetwork(run, {
      idempotent,
      signal: options.signal,
      delaysMs: retryDelaysMs,
    })
    return options.raw ? output : (JSON.parse(output) as unknown)
  }
  return {
    rest: request,
    async paginate(endpoint, options) {
      return z
        .array(z.array(z.unknown()))
        .parse(await request(endpoint, options, ['--paginate', '--slurp']))
        .flat()
    },
    async graphql(query, variables, paginate = false, options = {}) {
      // GraphQL reads are POST requests, so only mutations are unsafe to repeat.
      const idempotent = !/^\s*mutation\b/.test(query)
      // gh needs field arguments to update endCursor during GraphQL pagination.
      const result = paginate
        ? await request(
            'graphql',
            options,
            [
              '--paginate',
              '--slurp',
              '-f',
              `query=${query}`,
              ...Object.entries(variables).flatMap(([name, value]) => [
                '-f',
                `${name}=${String(value)}`,
              ]),
            ],
            idempotent,
          )
        : await request('graphql', { ...options, body: { query, variables } }, [], idempotent)
      for (const page of paginate ? z.array(z.unknown()).parse(result) : [result]) {
        const errors = envelope.parse(page).errors
        if (errors?.length) throw new Error(errors.map((error) => error.message).join('; '))
      }
      return result
    },
  }
}
