import express from 'express'
import { resolve } from 'node:path'
import { createServices, type ReviewerServerOptions } from './services'
import { HTTP_BODY_LIMIT } from './limits'
import { localOnly, contentSecurityPolicy, errorHandler } from './http/middleware'
import { pullsRouter } from './http/pullsRouter'
import { sourceRouter } from './http/sourceRouter'
import { settingsRouter } from './http/settingsRouter'
import { agentSessionsRouter } from './http/agentSessionsRouter'
import { gandalfRouter } from './http/gandalfRouter'
import { linusRouter } from './http/linusRouter'
import { listen } from './http/listen'
import { ticketsRouter } from './http/ticketsRouter'
import { jobsRouter } from './http/jobsRouter'
import { chatRouter } from './http/chatRouter'
import { teammatesRouter } from './http/teammatesRouter'
import { panelRouter } from './http/panelRouter'
import { splitRouter } from './http/splitRouter'
import { stackReviewRouter } from './http/stackReviewRouter'
import { openMcpEndpoint, type McpEndpoint } from './http/mcpEndpoint'
import { panelMcpServer } from './http/mcpTools'
import { MCP_PORT } from './features/mcp/limits'

export type { ReviewerServerOptions } from './services'

export async function startReviewerServer(options: ReviewerServerOptions) {
  const services = createServices(options)
  const app = express()
  let ownOrigin = ''
  let mcp: McpEndpoint | undefined
  app.disable('x-powered-by')
  app.use(
    localOnly(() => ownOrigin, options.allowedOrigins),
    contentSecurityPolicy(options.allowedOrigins),
    express.json({ limit: HTTP_BODY_LIMIT }),
  )
  app.use(
    '/api',
    pullsRouter(services),
    linusRouter(services),
    gandalfRouter(services),
    agentSessionsRouter(services),
    ticketsRouter(services),
    jobsRouter(services),
    chatRouter(services),
    teammatesRouter(services),
    panelRouter(services),
    splitRouter(services),
    stackReviewRouter(services),
    sourceRouter(services),
    settingsRouter(services, () => ({ url: mcp?.url, problem: mcp?.problem })),
  )
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Unknown API route.' })
  })
  app.use(express.static(resolve(options.staticDirectory)))
  app.get('/{*rest}', (_request, response) => {
    response.sendFile(resolve(options.staticDirectory, 'index.html'))
  })
  app.use(errorHandler)
  const server = await listen(
    app,
    services,
    (origin) => {
      ownOrigin = origin
    },
    options.port,
  )
  if (options.mcp)
    mcp = await openMcpEndpoint(
      () => panelMcpServer(services.panelTools),
      options.mcp.port ?? MCP_PORT,
    )
  return {
    ...server,
    /** Where coding agents connect, when the endpoint is served and its port was free. */
    mcpUrl: mcp?.url,
    // The endpoint closes first, so a tool waiting on a panel ends before the panel is stopped.
    close: async () => {
      await mcp?.close()
      await server.close()
    },
  }
}
