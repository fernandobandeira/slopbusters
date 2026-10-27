import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as Socket from 'effect/socket/Socket'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import { expect, it, vi } from 'vitest'
import {
  EngineConnection,
  EngineDisconnectedError,
  type EngineClient,
} from '../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../server/adapters/t3Engine/engineLocation'
import { UserError } from '../server/errors'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  pid: 4242,
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.1.0',
}

interface FakeSocket {
  readonly url: string
  readonly requests: string[]
  open: boolean
  /** The engine drops the socket, as when it restarts. */
  drop(): Promise<void>
  /** The socket fails the calls waiting on it with `reason`, as the RPC client does on a ping timeout. */
  fail(reason: Socket.SocketReadError): Promise<void>
}

/**
 * An engine that answers `server.probe` (after `probeDelayMs`) and leaves every other call, such
 * as a shell subscription, open. It records each socket the connection opens.
 */
function fakeEngine() {
  const sockets: FakeSocket[] = []
  const fake = { sockets, probeDelayMs: 0 }
  const protocol = (url: string) =>
    Layer.effect(
      RpcClient.Protocol,
      RpcClient.Protocol.make((writeResponse) =>
        Effect.gen(function* () {
          const hooks = yield* RpcClient.ConnectionHooks
          const scope = yield* Effect.scope
          const clients = new Set<number>()
          const socket: FakeSocket = {
            url,
            requests: [],
            open: true,
            drop: () => {
              socket.open = false
              return Effect.runPromise(hooks.onDisconnect)
            },
            fail: async (reason) => {
              const error = new RpcClientError({ reason })
              for (const clientId of clients)
                await Effect.runPromise(
                  writeResponse(clientId, { _tag: 'ClientProtocolError', error }),
                )
              await socket.drop()
            },
          }
          sockets.push(socket)
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              socket.open = false
            }),
          )
          return {
            send: (clientId, message) => {
              clients.add(clientId)
              if (message._tag !== 'Request') return Effect.void
              socket.requests.push(message.tag)
              if (message.tag !== 'server.probe') return Effect.void
              // Written when it arrives, as a socket would: the client may not be listening yet.
              const reply = Effect.suspend(() =>
                writeResponse(clientId, {
                  _tag: 'Exit',
                  requestId: message.id,
                  exit: { _tag: 'Success', value: {} },
                }),
              )
              return Effect.forkIn(Effect.delay(reply, fake.probeDelayMs), scope).pipe(
                Effect.asVoid,
              )
            },
            supportsAck: false,
            supportsTransferables: false,
            codecFor: RpcSerialization.json.codecFor,
          }
        }),
      ),
    )
  return Object.assign(fake, { protocol })
}

function connectionTo(fake: ReturnType<typeof fakeEngine>, locate = () => Promise.resolve(engine)) {
  let issued = 0
  const ticket = vi.fn(() =>
    Promise.resolve(Response.json({ ticket: `ticket-${String(++issued)}` })),
  )
  const connection = new EngineConnection({
    credentials: {
      get: () => ({ accessToken: 'saved', expiresAt: Number.MAX_SAFE_INTEGER }),
      save: () => undefined,
    },
    locate,
    fetch: ticket,
    protocol: fake.protocol,
  })
  return { connection, ticket }
}

const probe = (client: EngineClient) => client['server.probe']({})
const subscribeShell = (client: EngineClient) =>
  Stream.runHead(client['orchestration.subscribeShell']({}))

it('shares one socket and one ticket across calls, including a long stream', async () => {
  const fake = fakeEngine()
  const { connection, ticket } = connectionTo(fake)

  const stream = connection.run(subscribeShell).catch((error: unknown) => error)
  await connection.run(probe)
  await Promise.all([connection.run(probe), connection.run(probe)])

  expect(fake.sockets).toHaveLength(1)
  expect(ticket).toHaveBeenCalledTimes(1)
  expect(fake.sockets[0]?.url).toContain('wsTicket=ticket-1')
  expect(fake.sockets[0]?.requests.toSorted()).toEqual([
    'orchestration.subscribeShell',
    'server.probe',
    'server.probe',
    'server.probe',
  ])
  await connection.close()
  expect(await stream).toEqual(new Error('The operation was cancelled.'))
})

it('opens a new socket with a new ticket after the socket closes', async () => {
  const fake = fakeEngine()
  const { connection, ticket } = connectionTo(fake)
  await connection.run(probe)

  await fake.sockets[0]?.drop()
  await connection.run(probe)

  expect(fake.sockets).toHaveLength(2)
  expect(ticket).toHaveBeenCalledTimes(2)
  expect(fake.sockets[1]?.url).toContain('wsTicket=ticket-2')
  expect(fake.sockets[1]?.requests).toEqual(['server.probe'])
  await connection.close()
})

it('reports a socket that drops during a call as a lost connection, with its cause', async () => {
  const fake = fakeEngine()
  const { connection } = connectionTo(fake)
  const pending = connection.run(subscribeShell)
  await vi.waitFor(() => {
    expect(fake.sockets[0]?.requests).toEqual(['orchestration.subscribeShell'])
  })

  await fake.sockets[0]?.fail(new Socket.SocketReadError({ cause: new Error('ping timeout') }))

  const error: unknown = await pending.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(EngineDisconnectedError)
  expect(error).toHaveProperty(
    'message',
    'T3 Code lost the connection: An error occurred during Read (ping timeout)',
  )
  await connection.run(probe)
  expect(fake.sockets).toHaveLength(2)
  await connection.close()
})

it('opens a new socket when the engine restarts somewhere else', async () => {
  const fake = fakeEngine()
  let running = engine
  const { connection, ticket } = connectionTo(fake, () => Promise.resolve(running))
  await connection.run(probe)

  running = { ...engine, pid: 4343, origin: 'http://127.0.0.1:3774' }
  await connection.run(probe)

  expect(fake.sockets.map((socket) => socket.url.slice(0, 22))).toEqual([
    'ws://127.0.0.1:3773/ws',
    'ws://127.0.0.1:3774/ws',
  ])
  expect(ticket).toHaveBeenCalledTimes(2)
  await vi.waitFor(() => {
    expect(fake.sockets[0]?.open).toBe(false)
  })
  await connection.close()
})

it('recovers from a ticket the engine would not issue', async () => {
  const fake = fakeEngine()
  const { connection, ticket } = connectionTo(fake)
  ticket.mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 500 }))

  await expect(connection.run(probe)).rejects.toThrow('did not open a connection')
  await connection.run(probe)

  expect(fake.sockets).toHaveLength(1)
  expect(ticket).toHaveBeenCalledTimes(2)
  await connection.close()
})

it('times out or interrupts one call without breaking a concurrent call', async () => {
  const fake = fakeEngine()
  const { connection, ticket } = connectionTo(fake)
  fake.probeDelayMs = 80

  const [timedOut, interrupted, answered] = await Promise.allSettled([
    connection.run(subscribeShell, 20),
    connection.run((client) =>
      Effect.gen(function* () {
        const subscription = yield* Effect.forkChild(subscribeShell(client))
        yield* Effect.sleep(10)
        yield* Fiber.interrupt(subscription)
        return yield* Effect.interrupt
      }),
    ),
    connection.run(probe),
  ])

  expect(timedOut).toEqual({
    status: 'rejected',
    reason: new UserError('T3 Code took too long to respond.'),
  })
  expect(interrupted).toEqual({
    status: 'rejected',
    reason: new Error('The operation was cancelled.'),
  })
  expect(answered).toEqual({ status: 'fulfilled', value: {} })
  fake.probeDelayMs = 0
  await expect(connection.run(probe)).resolves.toEqual({})
  expect(fake.sockets).toHaveLength(1)
  expect(ticket).toHaveBeenCalledTimes(1)
  await connection.close()
})

it('releases the socket on close', async () => {
  const fake = fakeEngine()
  const { connection } = connectionTo(fake)
  await connection.run(probe)

  await connection.close()

  expect(fake.sockets[0]?.open).toBe(false)
  await expect(connection.run(probe)).rejects.toThrow('The operation was cancelled.')
})
