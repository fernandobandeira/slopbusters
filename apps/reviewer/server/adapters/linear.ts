import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { UserError } from '../errors'
import { LINEAR_TIMEOUT_MS, MAX_LINEAR_RESPONSE_BYTES, NETWORK_RETRY_DELAYS_MS } from '../limits'

const endpoint = 'https://api.linear.app/graphql'

export interface LinearRequestOptions {
  signal?: AbortSignal
  /** Mutations are never repeated after a request may have reached Linear. */
  mutation?: boolean
}
export interface Linear {
  configured: () => boolean
  request: <T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    options?: LinearRequestOptions,
  ) => Promise<T>
}

/** A Linear failure whose message is safe to show. */
export class LinearError extends UserError {
  constructor(
    message: string,
    status: number,
    readonly kind: 'unauthenticated' | 'not-found' | 'rate-limit' | 'network' | 'invalid',
  ) {
    super(message, status)
    this.name = 'LinearError'
  }
}

const envelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z
          .object({ type: z.string().optional(), code: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
})

export interface LinearAuthorization {
  configured(): boolean
  /** The Authorization header for the next request. */
  header(): Promise<string | undefined>
  /** Linear rejected the header: return a renewed one, if the credentials can be renewed. */
  rejected(): Promise<string | undefined>
}

export function createLinear(options: {
  authorization: LinearAuthorization
  fetch?: typeof fetch
  retryDelaysMs?: readonly number[]
}): Linear {
  const send = options.fetch ?? fetch
  const delays = options.retryDelaysMs ?? NETWORK_RETRY_DELAYS_MS
  async function post(key: string, body: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(LINEAR_TIMEOUT_MS)
    const response = await send(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    const text = await response.text()
    if (text.length > MAX_LINEAR_RESPONSE_BYTES)
      throw new LinearError('Linear returned more data than the app can read.', 502, 'invalid')
    return { status: response.status, text }
  }
  async function attempt(key: string, body: string, request: LinearRequestOptions) {
    for (let index = 0; ; index++) {
      try {
        const result = await post(key, body, request.signal)
        if (result.status < 500 || request.mutation) return result
        if (delays[index] === undefined) throw linearUnavailable()
      } catch (error) {
        if (request.signal?.aborted || error instanceof LinearError) throw error
        if (request.mutation || delays[index] === undefined) throw linearUnavailable(error)
      }
      await sleep(delays[index], undefined, { signal: request.signal })
    }
  }
  return {
    configured: () => options.authorization.configured(),
    async request(query, variables, schema, request = {}) {
      const header = await options.authorization.header()
      if (!header)
        throw new LinearError('Connect Linear in Settings to use issues.', 400, 'unauthenticated')
      const body = JSON.stringify({ query, variables })
      let result = await attempt(header, body, request)
      if (rejectedCredentials(result)) {
        const renewed = await options.authorization.rejected()
        if (renewed) result = await attempt(renewed, body, request)
      }
      return schema.parse(readEnvelope(result))
    },
  }
}

function readEnvelope({ status, text }: { status: number; text: string }): unknown {
  const parsed = parseEnvelope(status, text)
  const error = parsed.errors?.[0]
  const failure = classify(status, error)
  if (failure) throw failure
  if (parsed.data === undefined)
    throw new LinearError('Linear rejected the request: no data', 502, 'invalid')
  return parsed.data
}

function parseEnvelope(status: number, text: string) {
  try {
    return envelope.parse(JSON.parse(text))
  } catch (cause) {
    if (status === 401 || status === 403) throw unauthenticated()
    const error = new LinearError('Linear returned an unreadable response.', 502, 'invalid')
    error.cause = cause
    throw error
  }
}

function classify(
  status: number,
  error: NonNullable<z.infer<typeof envelope>['errors']>[number] | undefined,
): LinearError | undefined {
  const type = `${error?.extensions?.type ?? ''} ${error?.extensions?.code ?? ''}`
  if (status === 401 || status === 403 || /authenticat/i.test(type)) return unauthenticated()
  if (status === 429 || /ratelimit/i.test(type))
    return new LinearError(
      "Linear's API rate limit was reached. Retry in a few minutes.",
      429,
      'rate-limit',
    )
  if (error && /not found|could not find/i.test(error.message))
    return new LinearError('Linear could not find this issue.', 404, 'not-found')
  if (error) return new LinearError(`Linear rejected the request: ${error.message}`, 502, 'invalid')
  return undefined
}

function rejectedCredentials({ status, text }: { status: number; text: string }) {
  return status === 401 || (status === 400 && /authenticat/i.test(text.slice(0, 4000)))
}

function unauthenticated() {
  return new LinearError(
    'Linear rejected the API key. Update it in Settings.',
    401,
    'unauthenticated',
  )
}
function linearUnavailable(cause?: unknown) {
  const error = new LinearError(
    'Linear could not be reached. Check your internet connection and retry.',
    503,
    'network',
  )
  error.cause = cause
  return error
}
