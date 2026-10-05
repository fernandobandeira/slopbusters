import type { Express } from 'express'
import type { Services } from '../services'
import { DEFAULT_API_PORT } from '../limits'

export async function listen(
  app: Express,
  services: Services,
  setOrigin: (origin: string) => void,
  port = DEFAULT_API_PORT,
) {
  const server = app.listen(port, '127.0.0.1')
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
  let closing: Promise<void> | undefined
  return {
    url,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          void services.close().then(() => {
            error ? reject(error) : resolve()
          }, reject)
        })
        server.closeIdleConnections()
      })
      return closing
    },
  }
}
