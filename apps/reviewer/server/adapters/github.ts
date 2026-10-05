import { z } from 'zod'
import { runCommand } from './process'

export interface GitHubOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: string[]
  jq?: string
  raw?: boolean
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

export function createGitHub(runner = runCommand): GitHub {
  async function request(endpoint: string, options: GitHubOptions = {}, extra: string[] = []) {
    const output = await runner({
      command: 'gh',
      args: [
        'api',
        endpoint,
        ...(options.headers ?? []).flatMap((header) => ['-H', header]),
        ...(options.method ? ['--method', options.method] : []),
        ...(options.body === undefined ? [] : ['--input', '-']),
        ...(options.jq ? ['--jq', options.jq] : []),
        ...extra,
      ],
      input: options.body === undefined ? undefined : JSON.stringify(options.body),
      maxOutputBytes: options.maxOutputBytes,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
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
      // gh needs field arguments to update endCursor during GraphQL pagination.
      const result = paginate
        ? await request('graphql', options, [
            '--paginate',
            '--slurp',
            '-f',
            `query=${query}`,
            ...Object.entries(variables).flatMap(([name, value]) => [
              '-f',
              `${name}=${String(value)}`,
            ]),
          ])
        : await request('graphql', { ...options, body: { query, variables } })
      for (const page of paginate ? z.array(z.unknown()).parse(result) : [result]) {
        const errors = envelope.parse(page).errors
        if (errors?.length) throw new Error(errors.map((error) => error.message).join('; '))
      }
      return result
    },
  }
}
