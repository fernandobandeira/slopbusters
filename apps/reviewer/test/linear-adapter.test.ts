import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLinear, LinearError, type LinearAuthorization } from '../server/adapters/linear'
import { LinearAuth, linearOAuth } from '../server/adapters/linearAuth'
import { ReviewerStore } from '../server/adapters/store'

const viewer = z.object({ viewer: z.object({ name: z.string() }) })
function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}
function authorization(header = 'lin_api_key', rejected = vi.fn()): LinearAuthorization {
  rejected.mockResolvedValue('Bearer renewed')
  return { configured: () => true, header: () => Promise.resolve(header), rejected }
}

describe('Linear GraphQL adapter', () => {
  it('sends the credentials and returns validated data', async () => {
    const send = vi.fn(() => Promise.resolve(respond(200, { data: { viewer: { name: 'Avery' } } })))
    const linear = createLinear({ authorization: authorization(), fetch: send, retryDelaysMs: [] })

    const result = await linear.request('query { viewer { name } }', {}, viewer)

    expect(result.viewer.name).toBe('Avery')
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.linear.app/graphql')
    expect(new Headers(init.headers).get('Authorization')).toBe('lin_api_key')
  })
  it('renews a rejected OAuth token once and repeats the request', async () => {
    const rejected = vi.fn()
    const auth = authorization('Bearer expired', rejected)
    const send = vi
      .fn()
      .mockResolvedValueOnce(respond(401, { errors: [{ message: 'Authentication required' }] }))
      .mockResolvedValueOnce(respond(200, { data: { viewer: { name: 'Avery' } } }))
    const linear = createLinear({ authorization: auth, fetch: send, retryDelaysMs: [] })

    await linear.request('query { viewer { name } }', {}, viewer)

    expect(rejected).toHaveBeenCalledOnce()
    const retried = send.mock.calls[1] as unknown as [string, RequestInit]
    expect(new Headers(retried[1].headers).get('Authorization')).toBe('Bearer renewed')
  })
  it('explains missing issues and rate limits in words a user can act on', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { errors: [{ message: 'Entity not found: Issue' }] }))
      .mockResolvedValueOnce(
        respond(400, { errors: [{ message: 'Slow down', extensions: { code: 'RATELIMITED' } }] }),
      )
    const linear = createLinear({ authorization: authorization(), fetch: send, retryDelaysMs: [] })

    await expect(linear.request('q', {}, viewer)).rejects.toMatchObject({ kind: 'not-found' })
    await expect(linear.request('q', {}, viewer)).rejects.toMatchObject({ kind: 'rate-limit' })
  })
  it('retries reads after a dropped connection but never repeats a write', async () => {
    const dropped = () => Promise.reject(new TypeError('fetch failed'))
    const read = vi
      .fn()
      .mockImplementationOnce(dropped)
      .mockResolvedValueOnce(respond(200, { data: { viewer: { name: 'Avery' } } }))
    const reader = createLinear({ authorization: authorization(), fetch: read, retryDelaysMs: [0] })
    await expect(reader.request('q', {}, viewer)).resolves.toBeDefined()
    expect(read).toHaveBeenCalledTimes(2)

    const write = vi.fn(dropped)
    const writer = createLinear({
      authorization: authorization(),
      fetch: write,
      retryDelaysMs: [0],
    })
    await expect(writer.request('mutation', {}, viewer, { mutation: true })).rejects.toBeInstanceOf(
      LinearError,
    )
    expect(write).toHaveBeenCalledOnce()
  })
  it('asks the user to connect when there are no credentials', async () => {
    const linear = createLinear({
      authorization: {
        configured: () => false,
        header: () => Promise.resolve(undefined),
        rejected: () => Promise.resolve(undefined),
      },
      fetch: vi.fn(),
    })
    await expect(linear.request('q', {}, viewer)).rejects.toThrow(/Connect Linear/)
  })
})

describe('Linear sign-in', () => {
  let directory: string
  let store: ReviewerStore
  let auth: LinearAuth | undefined
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'linear-auth-'))
    store = new ReviewerStore({ dataDirectory: directory })
  })
  afterEach(() => {
    auth?.close()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('signs in with PKCE, stores the tokens, refreshes them, and revokes on disconnect', async () => {
    const port = 40000 + Math.floor(Math.random() * 10000)
    let now = 1_000_000
    const tokenRequests: URLSearchParams[] = []
    const send = vi.fn((url: string, init: RequestInit) => {
      const form = new URLSearchParams(init.body as string)
      if (url === linearOAuth.revoke) return Promise.resolve(new Response('', { status: 200 }))
      tokenRequests.push(form)
      const generation = String(tokenRequests.length)
      return Promise.resolve(
        respond(200, {
          access_token: `access-${generation}`,
          refresh_token: `refresh-${generation}`,
          expires_in: 86399,
        }),
      )
    })
    auth = new LinearAuth(store.tickets, {
      clientId: 'public-client',
      fetch: send as unknown as typeof fetch,
      callbackPort: port,
      now: () => now,
    })

    const authorize = new URL(await auth.begin())
    expect(authorize.origin + authorize.pathname).toBe(linearOAuth.authorize)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `http://localhost:${String(port)}/linear/callback`,
    )
    expect(auth.connecting()).toBe(true)

    const wrongState = await fetch(
      `http://127.0.0.1:${String(port)}/linear/callback?code=c&state=x`,
    )
    expect(wrongState.status).toBe(400)
    const overIpv6 = await fetch(`http://[::1]:${String(port)}/linear/callback?code=c&state=x`)
    expect(overIpv6.status).toBe(400)
    const state = authorize.searchParams.get('state') ?? ''
    const page = await fetch(
      `http://127.0.0.1:${String(port)}/linear/callback?code=granted&state=${state}`,
    )
    expect(await page.text()).toContain('Linear is connected')
    expect(auth.connecting()).toBe(false)
    expect(tokenRequests[0]?.get('code_verifier')).toBeTruthy()
    expect(tokenRequests[0]?.has('client_secret')).toBe(false)
    expect(await auth.header()).toBe('Bearer access-1')

    now += 86_400_000
    expect(await auth.header()).toBe('Bearer access-2')
    expect(tokenRequests[1]?.get('grant_type')).toBe('refresh_token')
    expect(tokenRequests[1]?.get('refresh_token')).toBe('refresh-1')

    await auth.disconnect()
    expect(auth.method()).toBe('none')
    expect(send).toHaveBeenLastCalledWith(linearOAuth.revoke, expect.anything())
  })
  it('keeps a personal API key without a browser round trip', async () => {
    auth = new LinearAuth(store.tickets)
    expect(auth.oauthAvailable()).toBe(false)
    await expect(auth.begin()).rejects.toThrow(/personal API key/)
    auth.saveKey('  lin_api_example  ')
    expect(await auth.header()).toBe('lin_api_example')
    expect(auth.method()).toBe('key')
  })
})
