import type { RequestHandler, ErrorRequestHandler } from 'express'
import { z } from 'zod'
import { UserError, logError } from '../errors'

export function localOnly(ownOrigin: () => string, allowedOrigins: string[] = []): RequestHandler {
  return (request, response, next) => {
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(request.hostname)) {
      response.status(403).json({ error: 'This app accepts local connections only.' })
      return
    }
    const origin = request.headers.origin
    if (origin && origin !== ownOrigin() && !allowedOrigins.includes(origin)) {
      response.status(403).json({ error: 'This request did not originate from the local app.' })
      return
    }
    next()
  }
}

export function contentSecurityPolicy(allowedOrigins: string[] = []): RequestHandler {
  const sockets = allowedOrigins.map((origin) => {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid development origin.')
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  })
  return (_request, response, next) => {
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self' ${sockets.join(' ')}; img-src 'self' data: https://github.com https://*.githubusercontent.com; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'`,
    )
    next()
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof UserError) {
    response.status(error.status).json({ error: error.message })
    return
  }
  if (
    error instanceof z.ZodError ||
    (error instanceof SyntaxError && 'status' in error && error.status === 400)
  ) {
    response.status(400).json({ error: 'The request contained invalid data.' })
    return
  }
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({ error: 'The request is too large.' })
    return
  }
  logError('HTTP request failed', error)
  response.status(500).json({ error: 'Something went wrong. Please retry.' })
}
