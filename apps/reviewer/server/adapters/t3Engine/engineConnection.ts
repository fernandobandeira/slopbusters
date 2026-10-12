import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as Socket from 'effect/unstable/socket/Socket'
import { z } from 'zod'
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
} from '@t3tools/contracts'
import { logError, UserError } from '../../errors'
import {
  T3_ENGINE_CALL_TIMEOUT_MS,
  T3_ENGINE_REQUEST_TIMEOUT_MS,
  T3_ENGINE_TOKEN_REFRESH_MARGIN_MS,
} from '../../limits'
import { findRunningEngine, type RunningEngine } from './engineLocation'
import { pairWithEngine, type EngineAccess } from './enginePairing'

const makeClient = RpcClient.make(WsRpcGroup)
/** The engine's typed WebSocket API: one method per RPC in T3 Code's contracts. */
export type EngineClient = Effect.Success<typeof makeClient>

export interface EngineCredentials {
  get(environmentId: string): EngineAccess | undefined
  save(environmentId: string, access: EngineAccess | undefined): void
}

export interface EngineConnectionOptions {
  readonly credentials: EngineCredentials
  readonly locate?: () => Promise<RunningEngine>
  readonly pair?: (engine: RunningEngine) => Promise<EngineAccess>
  readonly fetch?: typeof fetch
  readonly now?: () => number
  /** Opens the RPC transport; replaced in tests. */
  readonly protocol?: (socketUrl: string) => Layer.Layer<RpcClient.Protocol>
}

const ticketSchema = z.object({ ticket: z.string().min(1) })

/**
 * Typed access to the T3 Code engine the user is running. Each `run` locates the engine, reuses
 * or renews Slopbusters' paired session, and opens one authenticated WebSocket for its calls.
 */
export class EngineConnection {
  private readonly tickets: EngineTickets
  constructor(private readonly options: EngineConnectionOptions) {
    this.tickets = new EngineTickets(options)
  }

  /** The engine this connection reaches, started or found; it fails if none is available. */
  locate(): Promise<RunningEngine> {
    return (this.options.locate ?? findRunningEngine)()
  }

  async run<A, E>(
    operation: (client: EngineClient, engine: RunningEngine) => Effect.Effect<A, E>,
    timeoutMs = T3_ENGINE_CALL_TIMEOUT_MS,
  ): Promise<A> {
    const engine = await this.locate()
    const ticket = await this.tickets.next(engine)
    const protocol = (this.options.protocol ?? webSocketProtocol)(socketUrl(engine.origin, ticket))
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* makeClient
        return yield* operation(client, engine)
      }).pipe(Effect.timeout(timeoutMs), Effect.scoped, Effect.provide(protocol)),
    )
    if (Exit.isSuccess(exit)) return exit.value
    throw engineFailure(exit.cause)
  }
}

/**
 * One-time WebSocket tickets for an engine. The bearer session from pairing is saved and reused
 * until it nears expiry; if the engine no longer knows it, Slopbusters pairs again once.
 */
export class EngineTickets {
  constructor(
    private readonly options: Pick<
      EngineConnectionOptions,
      'credentials' | 'pair' | 'fetch' | 'now'
    >,
  ) {}

  async next(engine: RunningEngine): Promise<string> {
    const ticket = await this.request(engine, await this.access(engine))
    if (ticket) return ticket
    this.options.credentials.save(engine.environmentId, undefined)
    const renewed = await this.request(engine, await this.access(engine))
    if (renewed) return renewed
    throw new UserError(
      'T3 Code rejected Slopbusters. Remove Slopbusters from Connections in T3 Code settings, then try again.',
    )
  }

  private async access(engine: RunningEngine): Promise<EngineAccess> {
    const now = (this.options.now ?? Date.now)()
    const saved = this.options.credentials.get(engine.environmentId)
    if (saved && saved.expiresAt - T3_ENGINE_TOKEN_REFRESH_MARGIN_MS > now) return saved
    const access = await (this.options.pair ?? pairWithEngine)(engine)
    this.options.credentials.save(engine.environmentId, access)
    return access
  }

  private async request(engine: RunningEngine, access: EngineAccess): Promise<string | undefined> {
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(
        new URL('/api/auth/websocket-ticket', engine.origin),
        {
          method: 'POST',
          headers: { authorization: `Bearer ${access.accessToken}` },
          signal: AbortSignal.timeout(T3_ENGINE_REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new UserError('T3 Code is not answering. Restart T3 Code and try again.')
    }
    if (response.status === 401 || response.status === 403) return undefined
    const parsed = ticketSchema.safeParse(await response.json().catch(() => undefined))
    if (!response.ok || !parsed.success)
      throw new UserError('T3 Code did not open a connection for Slopbusters.')
    return parsed.data.ticket
  }
}

export function socketUrl(origin: string, ticket: string): string {
  const url = new URL('/ws', origin.replace(/^http/, 'ws'))
  url.searchParams.set('wsTicket', ticket)
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION))
  url.searchParams.set('clientSurface', 'desktop')
  return url.toString()
}

function webSocketProtocol(url: string): Layer.Layer<RpcClient.Protocol> {
  return Layer.effect(RpcClient.Protocol, RpcClient.makeProtocolSocket()).pipe(
    Layer.provide(
      Layer.mergeAll(
        Socket.layerWebSocket(url, { openTimeout: T3_ENGINE_REQUEST_TIMEOUT_MS }).pipe(
          Layer.provide(Socket.layerWebSocketConstructorGlobal),
        ),
        RpcSerialization.layerJson,
      ),
    ),
  )
}

/** Turn an engine failure into an error the UI can show; the full cause goes to the log. */
function engineFailure(cause: Cause.Cause<unknown>): Error {
  if (Cause.hasInterruptsOnly(cause)) return new Error('The operation was cancelled.')
  const error = Cause.squash(cause)
  logError('T3 Code engine call', Cause.pretty(cause))
  if (error instanceof UserError) return error
  if (Cause.isTimeoutError(error)) return new UserError('T3 Code took too long to respond.')
  const message = engineMessage(error)
  return new UserError(message ? `T3 Code: ${message}` : 'T3 Code could not complete the request.')
}

function engineMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const fields = error as { message?: unknown; detail?: unknown }
  for (const value of [fields.detail, fields.message])
    if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}
