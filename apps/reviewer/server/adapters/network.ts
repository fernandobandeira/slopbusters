import { setTimeout as sleep } from 'node:timers/promises'
import { UserError } from '../errors'
import { NETWORK_RETRY_DELAYS_MS } from '../limits'

/** A GitHub connection failure. Jobs may retry it; the message is safe to show. */
export class NetworkError extends UserError {
  constructor(message: string, cause: unknown) {
    super(message, 503)
    this.name = 'NetworkError'
    this.cause = cause
  }
}

interface RetryOptions {
  /** Reads may repeat after any dropped connection; writes only when no request was sent. */
  idempotent: boolean
  signal?: AbortSignal
  delaysMs?: readonly number[]
}

export async function retryNetwork<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const delays = options.delaysMs ?? NETWORK_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (options.signal?.aborted) throw error
      const failure = networkFailure(error)
      if (failure === 'rate-limit')
        throw new UserError("GitHub's API rate limit was reached. Retry in a few minutes.", 429)
      if (!failure) throw error
      const retryable = options.idempotent || failure === 'connect'
      const delay = delays[attempt]
      if (!retryable || delay === undefined)
        throw new NetworkError(failureMessage(failure, retryable), error)
      await sleep(delay, undefined, { signal: options.signal })
    }
  }
}

type NetworkFailure = 'connect' | 'transfer' | 'server' | 'rate-limit'

// gh reports Go network errors; git reports curl errors.
const failurePatterns: [NetworkFailure, RegExp][] = [
  ['rate-limit', /API rate limit exceeded|secondary rate limit/i],
  [
    'connect',
    /dial tcp|no such host|TLS handshake timeout|error connecting to|Could not resolve host|Failed to connect to|Couldn't connect to server|Connection refused|Resolving timed out|Network is unreachable/i,
  ],
  [
    'transfer',
    /connection reset|unexpected EOF|: EOF$|i\/o timeout|early EOF|RPC failed|remote end hung up unexpectedly|SSL_ERROR_SYSCALL|Recv failure|Operation timed out|transfer closed|http2: (stream|server sent GOAWAY)/im,
  ],
  ['server', /HTTP 50[234]\b|returned error: 50[234]\b/i],
]

function networkFailure(error: unknown): NetworkFailure | undefined {
  if (!(error instanceof Error) || error instanceof UserError) return undefined
  return failurePatterns.find(([, pattern]) => pattern.test(error.message))?.[0]
}

function failureMessage(failure: NetworkFailure, retryable: boolean) {
  if (!retryable)
    return 'The connection to GitHub dropped before it confirmed the update. Refresh to check whether it was saved before retrying.'
  if (failure === 'server') return 'GitHub is not responding right now. Retry in a moment.'
  return 'GitHub could not be reached. Check your internet connection and retry.'
}
