import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as RcMap from 'effect/RcMap'
import * as Schedule from 'effect/Schedule'
import * as Scope from 'effect/Scope'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as Socket from 'effect/socket/Socket'
import { z } from 'zod'
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  WsRpcGroup,
} from '@t3tools/contracts'
import { logError, UserError } from '../../errors'
import {
  T3_ENGINE_CALL_TIMEOUT_MS,
  T3_ENGINE_IDLE_SOCKET_MS,
  T3_ENGINE_PING_TIMEOUT_MS,
  T3_ENGINE_REQUEST_TIMEOUT_MS,
  T3_ENGINE_TOKEN_REFRESH_MARGIN_MS,
} from './limits'
import { EngineUnreachableError, findRunningEngine, type RunningEngine } from './engineLocation'
import { pairWithEngine, type EngineAccess } from './enginePairing'

const makeClient = RpcClient.make(WsRpcGroup)
/** The engine's typed WebSocket API: one method per RPC in the vendored `WsRpcGroup`. */
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
  /** Opens the RPC transport, reporting a closed socket through its hooks; replaced in tests. */
  readonly protocol?: (
    socketUrl: string,
  ) => Layer.Layer<RpcClient.Protocol, never, RpcClient.ConnectionHooks>
}

const ticketSchema = z.object({ ticket: z.string().min(1) })

/**
 * The socket to the engine dropped during a call, as when the computer sleeps past the ping
 * timeout. The engine and the work it was doing may be fine; the next call opens a new socket.
 */
export class EngineDisconnectedError extends UserError {}

const SOCKET_FAILURES: ReadonlySet<string> = new Set([
  'SocketReadError',
  'SocketWriteError',
  'SocketCloseError',
  'SocketOpenError',
])

/**
 * Typed access to a T3 Code engine. Calls share one authenticated WebSocket per engine: it opens
 * with a one-time ticket on first use and is replaced, with a new ticket, once it closes or the
 * engine restarts. Each `run` still has its own timeout, interruption and error mapping.
 */
export class EngineConnection {
  private readonly tickets: EngineTickets
  private readonly scope = Scope.makeUnsafe()
  private readonly sockets: RcMap.RcMap<EngineSocket, EngineClient, unknown>
  private current: EngineSocket | undefined
  private opened = 0

  constructor(private readonly options: EngineConnectionOptions) {
    this.tickets = new EngineTickets(options)
    this.sockets = Effect.runSync(
      RcMap.make({
        lookup: (socket: EngineSocket) => this.open(socket),
        idleTimeToLive: T3_ENGINE_IDLE_SOCKET_MS,
      }).pipe(Scope.provide(this.scope)),
    )
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
    const exit = await Effect.runPromiseExit(
      RcMap.get(this.sockets, this.socketTo(engine)).pipe(
        Effect.flatMap((client) => operation(client, engine)),
        Effect.timeout(timeoutMs),
        Effect.scoped,
      ),
    )
    if (Exit.isSuccess(exit)) return exit.value
    throw engineFailure(exit.cause)
  }

  /** Close the socket and its client; calls still running are cancelled. */
  close(): Promise<void> {
    return Effect.runPromise(Scope.close(this.scope, Exit.void))
  }

  /** The open socket when it reaches this engine; otherwise a new one replaces it. */
  private socketTo(engine: RunningEngine): EngineSocket {
    const current = this.current
    if (current && sameEngine(current.engine, engine)) return current
    if (current) Effect.runFork(this.discard(current))
    this.current = { engine, number: ++this.opened }
    return this.current
  }

  /** Opens the socket with a fresh ticket; it is discarded when it closes or fails to open. */
  private open(socket: EngineSocket): Effect.Effect<EngineClient, unknown, Scope.Scope> {
    const { engine } = socket
    const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
      onConnect: Effect.void,
      onDisconnect: this.discard(socket),
    })
    const protocol = this.options.protocol ?? webSocketProtocol
    return Effect.tryPromise({
      try: () => this.tickets.next(engine),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((ticket) =>
        Layer.build(protocol(socketUrl(engine.origin, ticket)).pipe(Layer.provide(hooks))),
      ),
      Effect.flatMap((context) => Effect.provideContext(makeClient, context)),
      Effect.onError(() => this.discard(socket)),
    )
  }

  /** Stop handing out a socket; it closes once its last call ends, and the next call opens another. */
  private discard(socket: EngineSocket): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.current === socket) this.current = undefined
      // Forked, because a socket's own disconnect hook runs inside the scope this closes.
      return Effect.forkDetach(RcMap.invalidate(this.sockets, socket))
    }).pipe(Effect.asVoid)
  }
}

/** One socket to one engine. A closed socket is never reopened: its ticket was single-use. */
interface EngineSocket {
  readonly engine: RunningEngine
  readonly number: number
}

function sameEngine(a: RunningEngine, b: RunningEngine): boolean {
  return a.origin === b.origin && a.environmentId === b.environmentId && a.pid === b.pid
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
      throw new EngineUnreachableError()
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
  // The ticket in the URL is single-use, so a dropped socket is replaced rather than retried.
  const protocol = RpcClient.makeProtocolSocket({
    retryPolicy: Schedule.recurs(0),
    pingTimeout: T3_ENGINE_PING_TIMEOUT_MS,
  })
  return Layer.effect(RpcClient.Protocol, protocol).pipe(
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
  const dropped = socketFailure(error)
  if (dropped) return new EngineDisconnectedError(`T3 Code lost the connection: ${dropped}`)
  const message = engineMessage(error)
  return new UserError(message ? `T3 Code: ${message}` : 'T3 Code could not complete the request.')
}

/** What went wrong with the socket, with its cause, such as `ping timeout`, when it has one. */
function socketFailure(error: unknown): string | undefined {
  if (!(error instanceof RpcClientError) || !SOCKET_FAILURES.has(error.reason._tag))
    return undefined
  const { reason } = error
  const cause = 'cause' in reason && reason.cause instanceof Error ? reason.cause.message : ''
  return cause ? `${reason.message} (${cause})` : reason.message
}

function engineMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const fields = error as { message?: unknown; detail?: unknown }
  for (const value of [fields.detail, fields.message])
    if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}
