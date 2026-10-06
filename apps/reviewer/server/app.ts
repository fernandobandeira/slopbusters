import express from 'express'
import { resolve } from 'node:path'
import { createServices, type ReviewerServerOptions } from './services'
import { HTTP_BODY_LIMIT } from './limits'
import { localOnly, contentSecurityPolicy, errorHandler } from './http/middleware'
import { pullsRouter } from './http/pullsRouter'
import { sourceRouter } from './http/sourceRouter'
import { settingsRouter } from './http/settingsRouter'
import { bobRouter } from './http/bobRouter'
import { gandalfRouter } from './http/gandalfRouter'
import { linusRouter } from './http/linusRouter'
import { listen } from './http/listen'

export type { ReviewerServerOptions } from './services'

export async function startReviewerServer(options: ReviewerServerOptions) {
  const services = createServices(options)
  const app = express()
  let ownOrigin = ''
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
    bobRouter(services),
    sourceRouter(services),
    settingsRouter(services),
  )
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Unknown API route.' })
  })
  app.use(express.static(resolve(options.staticDirectory)))
  app.get('/{*rest}', (_request, response) => {
    response.sendFile(resolve(options.staticDirectory, 'index.html'))
  })
  app.use(errorHandler)
  return listen(
    app,
    services,
    (origin) => {
      ownOrigin = origin
    },
    options.port,
  )
}
