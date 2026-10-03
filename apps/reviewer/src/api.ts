export async function api<TResult>(endpoint: string, options?: RequestInit): Promise<TResult> {
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const body = await response.json().catch(() => {
    throw new Error(
      'Slopbusters could not connect to its local service. Refresh or restart the app, then try again.',
    )
  })
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'The request failed.')
  return body as TResult
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
