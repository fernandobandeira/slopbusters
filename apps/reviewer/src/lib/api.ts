import type { z } from 'zod'
import { routeUrl, type ApiContract, type CallInput } from '../../shared/api/contract'

export async function call<C extends ApiContract>(
  contract: C,
  input: CallInput<C>,
  options?: Omit<RequestInit, 'method' | 'body'>,
): Promise<z.output<C['response']>> {
  const body = contract.request.parse(input.body)
  const headers = new Headers(options?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(routeUrl(contract, input), {
    ...options,
    method: contract.method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
  })
  const value: unknown = await response.json().catch(() => {
    throw new Error(
      'Slopbusters could not connect to its local service. Refresh or restart the app, then try again.',
    )
  })
  if (!response.ok) {
    const error = value && typeof value === 'object' && 'error' in value ? value.error : undefined
    throw new Error(typeof error === 'string' ? error : 'The request failed.')
  }
  const result = contract.response.safeParse(value)
  if (!result.success)
    throw new Error(
      'The local service returned an invalid response. Restart the app and try again.',
    )
  return result.data as z.output<C['response']>
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
