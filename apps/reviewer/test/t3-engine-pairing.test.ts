import { describe, expect, it, vi } from 'vitest'
import {
  exchangePairingToken,
  findEngineCli,
  pairWithEngine,
  parsePairingToken,
  type EngineAccess,
} from '../server/adapters/t3Engine/enginePairing'
import { EngineTickets } from '../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../server/adapters/t3Engine/engineLocation'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  pid: 4242,
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.1.0',
}
const pairOutput = `█▀▀▀▀▀█ ▄▄ █▀▀▀▀▀█
█ ███ █ ▀▄ █ ███ █
Pairing URL: http://127.0.0.1:3773/pair#token=one-time-token
Token: one-time-token
Expires: 2026-10-12T15:00:00.000Z
`
const day = 24 * 60 * 60 * 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
function bearer(token: string, expiresIn: number) {
  return json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope: 'x' })
}
function asFetch(mock: unknown): typeof fetch {
  return mock as typeof fetch
}

describe('pairing with T3 Code', () => {
  it('reads the one-time token from t3 pair output around the QR code', () => {
    expect(parsePairingToken(pairOutput)).toBe('one-time-token')
    expect(() => parsePairingToken('Pairing URL only')).toThrow('did not return a pairing token')
  })

  it('exchanges the one-time token for a bearer session through OAuth token exchange', async () => {
    const fetch = vi.fn((_url: URL, _init: { body: URLSearchParams }) =>
      Promise.resolve(bearer('bearer-token', 3600)),
    )

    const access = await exchangePairingToken(engine.origin, 'one-time-token', {
      fetch: asFetch(fetch),
      now: () => 1000,
    })

    expect(access).toEqual({ accessToken: 'bearer-token', expiresAt: 1000 + 3600 * 1000 })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url?.href).toBe('http://127.0.0.1:3773/oauth/token')
    expect(Object.fromEntries(init?.body ?? [])).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'one-time-token',
      subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      client_label: 'Slopbusters',
    })
  })

  it('refuses a proof-bound or failed exchange', async () => {
    const proofBound = vi
      .fn()
      .mockResolvedValue(
        json({ access_token: 'bound', token_type: 'DPoP', expires_in: 3600, scope: 'x' }),
      )
    const rejected = vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400))

    await expect(
      exchangePairingToken(engine.origin, 'token', { fetch: asFetch(proofBound) }),
    ).rejects.toThrow('refused the pairing')
    await expect(
      exchangePairingToken(engine.origin, 'token', { fetch: asFetch(rejected) }),
    ).rejects.toThrow('refused the pairing')
  })

  it('runs t3 pair against the engine home with a Slopbusters label', async () => {
    const run = vi.fn().mockResolvedValue(pairOutput)
    const fetch = vi.fn().mockResolvedValue(bearer('bearer-token', 60))

    await pairWithEngine(engine, {
      cli: { command: '/home/user/.t3/bin/t3', args: [], env: { T3CODE_HOME: engine.home } },
      run,
      fetch: asFetch(fetch),
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/home/user/.t3/bin/t3',
        args: ['pair', '--label', 'Slopbusters', '--ttl', '2m'],
        env: { T3CODE_HOME: engine.home },
      }),
    )
  })
})

describe('finding the t3 CLI', () => {
  it('prefers the launcher the desktop app keeps in the T3 home', () => {
    const launcher = '/home/user/.t3/bin/t3'

    const cli = findEngineCli('/home/user/.t3', (path) => path === launcher, 'darwin')

    expect(cli).toEqual({ command: launcher, args: [], env: { T3CODE_HOME: '/home/user/.t3' } })
  })

  it('runs the CLI bundled in an older macOS app as Node', () => {
    const executable = '/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)'

    const cli = findEngineCli('/home/user/.t3', (path) => path === executable, 'darwin')

    expect(cli).toEqual({
      command: executable,
      args: [
        '/Applications/T3 Code (Alpha).app/Contents/Resources/app.asar/apps/server/dist/bin.mjs',
      ],
      env: { T3CODE_HOME: '/home/user/.t3', ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to t3 on PATH', () => {
    expect(findEngineCli('/home/user/.t3', () => false, 'linux').command).toBe('t3')
  })
})

function savedCredentials(initial: EngineAccess) {
  const values = new Map([[engine.environmentId, initial]])
  return {
    values,
    get: (id: string) => values.get(id),
    save: (id: string, access: EngineAccess | undefined) => {
      if (access) values.set(id, access)
      else values.delete(id)
    },
  }
}

describe('engine WebSocket tickets', () => {
  it('reuses a saved session that is not near expiry', async () => {
    const pair = vi.fn()
    const fetch = vi.fn().mockResolvedValue(json({ ticket: 'ticket-1' }))
    const tickets = new EngineTickets({
      credentials: savedCredentials({ accessToken: 'saved', expiresAt: 10 * day }),
      pair,
      fetch: asFetch(fetch),
      now: () => 0,
    })

    const ticket = await tickets.next(engine)

    expect(ticket).toBe('ticket-1')
    expect(pair).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith(
      new URL('/api/auth/websocket-ticket', engine.origin),
      expect.objectContaining({ headers: { authorization: 'Bearer saved' } }),
    )
  })

  it('pairs again once when the engine no longer knows the saved session', async () => {
    const credentials = savedCredentials({ accessToken: 'forgotten', expiresAt: 10 * day })
    const pair = vi.fn().mockResolvedValue({ accessToken: 'renewed', expiresAt: 30 * day })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(json({ ticket: 'ticket-2' }))
    const tickets = new EngineTickets({ credentials, pair, fetch: asFetch(fetch), now: () => 0 })

    const ticket = await tickets.next(engine)

    expect(ticket).toBe('ticket-2')
    expect(pair).toHaveBeenCalledTimes(1)
    expect(credentials.values.get(engine.environmentId)?.accessToken).toBe('renewed')
  })

  it('renews a session within a day of expiry and stops after a second rejection', async () => {
    const pair = vi.fn().mockResolvedValue({ accessToken: 'fresh', expiresAt: 30 * day })
    const fetch = vi.fn().mockResolvedValue(json({ error: 'unauthorized' }, 401))
    const tickets = new EngineTickets({
      credentials: savedCredentials({ accessToken: 'expiring', expiresAt: day / 2 }),
      pair,
      fetch: asFetch(fetch),
      now: () => 0,
    })

    await expect(tickets.next(engine)).rejects.toThrow('T3 Code rejected Slopbusters')

    expect(pair).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
