import { resolve } from 'node:path'
import { startReviewerServer } from './app'

const server = await startReviewerServer({
  dataDirectory: resolve('.data'),
  staticDirectory: resolve('dist'),
  port: 4311,
  allowedOrigins: ['http://127.0.0.1:4310', 'http://localhost:4310'],
})
console.log(`Slopbusters API: ${server.url}`)
function shutdown() {
  void server.close().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
