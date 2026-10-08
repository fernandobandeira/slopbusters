import { createHash, randomBytes } from 'node:crypto'
import { createServer, type RequestListener, type Server } from 'node:http'
import { z } from 'zod'
import { logError, UserError } from '../errors'
import { LINEAR_OAUTH_TIMEOUT_MS, LINEAR_TIMEOUT_MS } from '../limits'
import type { LinearCredentials, TicketStore } from './ticketStore'

export const linearOAuth = {
  authorize: 'https://linear.app/oauth/authorize',
  token: 'https://api.linear.app/oauth/token',
  revoke: 'https://api.linear.app/oauth/revoke',
  /** Register exactly this callback on the Linear OAuth application. */
  callbackPort: 47811,
  callbackPath: '/linear/callback',
  scopes: 'read,write',
}
export function linearCallbackUrl(port = linearOAuth.callbackPort) {
  return `http://localhost:${String(port)}${linearOAuth.callbackPath}`
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
})
/** Refresh a minute early so a request never carries a token that expires on the way. */
const REFRESH_MARGIN_MS = 60_000

export interface LinearAuthOptions {
  clientId?: string
  fetch?: typeof fetch
  callbackPort?: number
  now?: () => number
}

/**
 * Linear sign-in for a local app: OAuth with PKCE, so no client secret ships with the app,
 * and a personal API key for workspaces that block OAuth applications.
 */
export class LinearAuth {
  private readonly send: typeof fetch
  private readonly now: () => number
  private refreshing?: Promise<string | undefined>
  private flow?: { servers: Server[]; timer: NodeJS.Timeout }
  constructor(
    private readonly store: TicketStore,
    private readonly options: LinearAuthOptions = {},
  ) {
    this.send = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }
  configured(): boolean {
    return Boolean(this.store.linearCredentials())
  }
  method(): 'oauth' | 'key' | 'none' {
    return this.store.linearCredentials()?.kind ?? 'none'
  }
  oauthAvailable(): boolean {
    return Boolean(this.options.clientId)
  }
  connecting(): boolean {
    return Boolean(this.flow)
  }

  /** The Authorization header for the next request, refreshing an expiring OAuth token. */
  async header(): Promise<string | undefined> {
    const credentials = this.store.linearCredentials()
    if (!credentials) return undefined
    if (credentials.kind === 'key') return credentials.key
    if (credentials.expiresAt - REFRESH_MARGIN_MS > this.now())
      return `Bearer ${credentials.accessToken}`
    return this.refresh()
  }
  /** Linear rejected the current token: refresh once, or report that it cannot be renewed. */
  async rejected(): Promise<string | undefined> {
    return this.store.linearCredentials()?.kind === 'oauth' ? this.refresh() : undefined
  }

  saveKey(key: string) {
    this.cancelFlow()
    this.store.saveLinearCredentials({ kind: 'key', key: key.trim() })
  }
  async disconnect() {
    this.cancelFlow()
    const credentials = this.store.linearCredentials()
    this.store.saveLinearCredentials(undefined)
    if (credentials?.kind === 'oauth')
      await this.post(linearOAuth.revoke, { token: credentials.refreshToken }).catch(
        (error: unknown) => {
          logError('Revoking the Linear token', error)
        },
      )
  }

  /** Start listening for Linear's redirect and return the page the user approves access on. */
  async begin(): Promise<string> {
    const clientId = this.options.clientId
    if (!clientId)
      throw new UserError('This build cannot sign in to Linear. Use a personal API key instead.')
    this.cancelFlow()
    const verifier = randomBytes(48).toString('base64url')
    const state = randomBytes(24).toString('base64url')
    const port = this.options.callbackPort ?? linearOAuth.callbackPort
    const servers = await listenOnLoopback(port, (request, response) => {
      void this.callback(new URL(request.url ?? '/', 'http://localhost'), {
        state,
        verifier,
        port,
      }).then((page) => {
        // Stop waiting at once, but close the listener only after the browser has the page.
        const finished = page.finished ? this.detachFlow() : undefined
        response.writeHead(page.status, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(page.body, () => {
          finished?.servers.forEach(closeListener)
        })
      })
    })
    const timer = setTimeout(() => {
      this.cancelFlow()
    }, LINEAR_OAUTH_TIMEOUT_MS)
    this.flow = { servers, timer }
    const url = new URL(linearOAuth.authorize)
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: linearCallbackUrl(port),
      response_type: 'code',
      scope: linearOAuth.scopes,
      state,
      prompt: 'consent',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString()
    return url.href
  }

  private async callback(
    url: URL,
    flow: { state: string; verifier: string; port: number },
  ): Promise<{ status: number; body: string; finished?: boolean }> {
    if (url.pathname !== linearOAuth.callbackPath) return page(404, 'Not found.')
    if (url.searchParams.get('state') !== flow.state)
      return page(400, 'This sign-in link is out of date. Start again from Slopbusters.')
    const code = url.searchParams.get('code')
    if (!code)
      return {
        ...page(400, 'Linear did not grant access. You can close this tab.'),
        finished: true,
      }
    try {
      const tokens = await this.post(linearOAuth.token, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: linearCallbackUrl(flow.port),
        client_id: this.options.clientId ?? '',
        code_verifier: flow.verifier,
      })
      this.store.saveLinearCredentials(this.credentials(tokens))
      return {
        ...page(200, 'Linear is connected. You can close this tab and return to Slopbusters.'),
        finished: true,
      }
    } catch (error) {
      logError('Completing Linear sign-in', error)
      return {
        ...page(502, 'Linear sign-in failed. Close this tab and try again from Slopbusters.'),
        finished: true,
      }
    }
  }

  private refresh(): Promise<string | undefined> {
    this.refreshing ??= (async () => {
      const credentials = this.store.linearCredentials()
      if (credentials?.kind !== 'oauth') return undefined
      try {
        const tokens = await this.post(linearOAuth.token, {
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: this.options.clientId ?? '',
        })
        const next = this.credentials(tokens)
        this.store.saveLinearCredentials(next)
        return `Bearer ${next.accessToken}`
      } catch (error) {
        logError('Refreshing the Linear token', error)
        return undefined
      }
    })().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private credentials(response: unknown): Extract<LinearCredentials, { kind: 'oauth' }> {
    const tokens = tokenResponse.parse(response)
    return {
      kind: 'oauth',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: this.now() + tokens.expires_in * 1000,
    }
  }
  private async post(url: string, form: Record<string, string>): Promise<unknown> {
    const response = await this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Linear OAuth returned HTTP ${String(response.status)}.`)
    const text = await response.text()
    return text ? (JSON.parse(text) as unknown) : {}
  }
  private detachFlow() {
    const flow = this.flow
    if (flow) clearTimeout(flow.timer)
    this.flow = undefined
    return flow
  }
  private cancelFlow() {
    this.detachFlow()?.servers.forEach(closeListener)
  }
  close() {
    this.cancelFlow()
  }
}

/**
 * The callback says "localhost", which a browser may resolve to IPv4 or IPv6 first. Listen on
 * both loopback addresses; IPv4 is required, IPv6 only where the machine has it.
 */
async function listenOnLoopback(port: number, handler: RequestListener): Promise<Server[]> {
  const ipv4 = await listen(createServer(handler), port, '127.0.0.1').catch((error: unknown) => {
    logError('Starting the Linear sign-in listener', error)
    throw new UserError(
      `Another program is using port ${String(port)}, which Linear sign-in needs. Close it and retry, or use an API key.`,
    )
  })
  const ipv6 = await listen(createServer(handler), port, '::1').catch((error: unknown) => {
    logError('Linear sign-in is listening on IPv4 only', error)
    return undefined
  })
  return ipv6 ? [ipv4, ipv6] : [ipv4]
}

function listen(server: Server, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

function closeListener(server: Server) {
  server.close()
  server.closeAllConnections()
}

function page(status: number, message: string) {
  return {
    status,
    body: `<!doctype html><meta charset="utf-8"><title>Slopbusters</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem;text-align:center"><h1>Slopbusters</h1><p>${message}</p></body>`,
  }
}
