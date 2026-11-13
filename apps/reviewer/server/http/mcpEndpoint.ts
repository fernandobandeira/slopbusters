import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { createServer } from 'node:http'
import { logError } from '../errors'
import { HTTP_BODY_LIMIT } from '../limits'
import { errorHandler, localOnly } from './middleware'

/** Where coding agents reach the app over MCP, or why they cannot. */
export interface McpEndpoint {
  url?: string
  problem?: string
  close(): Promise<void>
}

/**
 * Serve MCP to coding agents on its own loopback port, apart from the app's API: the port is
 * fixed so an agent's configuration keeps working, and only what agents are meant to do is
 * reachable there. Each request gets its own server, so nothing is kept between calls. A port
 * another program holds leaves the app running without the endpoint.
 */
export async function openMcpEndpoint(
  createMcpServer: () => McpServer,
  port: number,
): Promise<McpEndpoint> {
  const app = express()
  app.disable('x-powered-by')
  // Agents send no Origin; a request that has one comes from a web page.
  app.use(
    localOnly(() => ''),
    express.json({ limit: HTTP_BODY_LIMIT }),
  )
  app.post('/mcp', async (request, response) => {
    const server = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    // Ends a tool still waiting when the agent hangs up or the app closes.
    response.once('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
  })
  app.use('/mcp', (_request, response) => {
    response.status(405).set('Allow', 'POST').json({ error: 'Send MCP requests with POST.' })
  })
  app.use((_request, response) => {
    response.status(404).json({ error: 'Coding agents connect at /mcp.' })
  })
  app.use(errorHandler)
  const server = createServer(app)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    logError('Starting the MCP endpoint', error)
    const taken = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
    return {
      problem: taken
        ? `Another program is using port ${String(port)}, so coding agents cannot reach Slopbusters. Quit it and restart Slopbusters.`
        : `Slopbusters could not open port ${String(port)}, so coding agents cannot reach it.`,
      close: () => Promise.resolve(),
    }
  }
  const address = server.address()
  const listening = address && typeof address !== 'string' ? address.port : port
  return {
    url: `http://127.0.0.1:${String(listening)}/mcp`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}
