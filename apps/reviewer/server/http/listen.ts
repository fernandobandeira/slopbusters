import type { Express } from 'express'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Services } from '../services'
import { DEFAULT_API_PORT } from '../limits'

export async function listen(
  app: Express,
  services: Services,
  setOrigin: (origin: string) => void,
  port = DEFAULT_API_PORT,
) {
  const server = app.listen(port, '127.0.0.1')
  const connections = trackConnections(server)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
  } catch (error) {
    await services.close()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Could not start the local review server.')
  const url = `http://127.0.0.1:${address.port}`
  setOrigin(url)
  try {
    await services.gandalfJobs.resume()
  } catch (error) {
    server.close()
    await services.close()
    throw error
  }
  let closing: Promise<void> | undefined
  return {
    url,
    suspend: () => services.gandalfJobs.suspend(),
    resume: () => services.gandalfJobs.resume(),
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          void services.close().then(() => {
            if (error) reject(error)
            else resolve()
          }, reject)
        })
        connections.drain()
      })
      return closing
    },
  }
}

/**
 * `server.close()` waits for every open connection but ends only the idle ones. Node counts a
 * connection that has not sent its first request as busy, and closing the server also stops the
 * timer that would end it. Browsers open such spare connections ahead of need and keep them, so
 * draining ends them here, and ends each busy connection once its last response is sent.
 */
function trackConnections(server: Server) {
  const responses = new Map<Socket, Set<ServerResponse>>()
  let draining = false
  const endWhenIdle = (socket: Socket) => {
    if (!responses.get(socket)?.size) socket.destroySoon()
  }
  server.prependListener('connection', (socket: Socket) => {
    responses.set(socket, new Set())
    socket.once('close', () => responses.delete(socket))
  })
  server.prependListener('request', (request: IncomingMessage, response: ServerResponse) => {
    const { socket } = request
    const open = responses.get(socket)
    open?.add(response)
    if (draining) response.shouldKeepAlive = false
    response.once('close', () => {
      open?.delete(response)
      if (draining) endWhenIdle(socket)
    })
  })
  return {
    drain() {
      draining = true
      for (const [socket, open] of responses) {
        for (const response of open) if (!response.headersSent) response.shouldKeepAlive = false
        endWhenIdle(socket)
      }
    },
  }
}
