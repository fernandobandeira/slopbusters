import { resolve } from 'node:path'
import { startReviewerServer } from './app'

// The installed app owns the agents' port; a development server serves them only on a port asked for.
const mcpPort = Number(process.env.SLOPBUSTERS_MCP_PORT)

const server = await startReviewerServer({
  dataDirectory: resolve('.data'),
  staticDirectory: resolve('dist'),
  bobSkillDirectory: resolve('../../skills/unclebob'),
  linusSkillDirectory: resolve('../../skills/linus'),
  jobsSkillDirectory: resolve('../../skills/jobs'),
  terminatorSkillDirectory: resolve('../../skills/terminator'),
  port: 4311,
  ...(Number.isInteger(mcpPort) && mcpPort > 0 ? { mcp: { port: mcpPort } } : {}),
  allowedOrigins: ['http://127.0.0.1:4310', 'http://localhost:4310'],
})
console.log(`Slopbusters API: ${server.url}`)
if (server.mcpUrl) console.log(`Slopbusters MCP: ${server.mcpUrl}`)
function shutdown() {
  void server.close().then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
