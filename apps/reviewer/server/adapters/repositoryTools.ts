import express from 'express'
import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { DiffSide, type PullRequest } from '../../shared/domain/types'
import type { NavigationRequest, NavigationResult } from '../../shared/domain/navigation'
import type { WorkspaceLease } from './reviewWorkspaces'
import type { SourceProject } from './sourceWorkspace'
import { workspacePath } from './sourceWorkspace'

export interface RepositoryContext {
  directory: string
  sha: string
  url: string
  token: string
  close: () => Promise<void>
}

const pathSchema = z.string().min(1).max(2000)
const position = {
  path: pathSchema,
  line: z.number().int().positive().max(1_000_000),
  column: z.number().int().positive().max(1_000_000),
  side: z.enum(DiffSide).default(DiffSide.right),
}
const schemas = {
  list_files: z
    .object({
      prefix: z.string().max(2000).default(''),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  read_file: z
    .object({
      path: pathSchema,
      startLine: z.number().int().positive().default(1),
      lines: z.number().int().min(1).max(500).default(200),
    })
    .strict(),
  search_text: z
    .object({ query: z.string().min(1).max(200), prefix: z.string().max(2000).default('') })
    .strict(),
  go_to_definition: z.object(position).strict(),
  find_references: z.object(position).strict(),
  find_implementations: z.object(position).strict(),
}
const descriptions: Record<keyof typeof schemas, string> = {
  list_files: 'List committed files in the reviewed repository. Paginate with offset.',
  read_file: 'Read numbered lines from a committed file at the saved PR head.',
  search_text:
    'Search literal text across committed source, including files outside the diff. Results report truncation.',
  go_to_definition:
    'Resolve a source symbol using the same language service as the review UI. Coordinates are one-based UTF-16.',
  find_references:
    'Find semantic references using the review workspace. Coordinates are one-based UTF-16.',
  find_implementations:
    'Find implementations using the review workspace. Coordinates are one-based UTF-16.',
}

/** A short-lived authenticated MCP endpoint exposes inspection only, scoped to one PR. */
export async function startRepositoryTools(
  pull: PullRequest,
  lease: WorkspaceLease,
  project: SourceProject,
  navigate: (pull: PullRequest, request: NavigationRequest) => Promise<NavigationResult>,
): Promise<RepositoryContext> {
  const token = randomBytes(32).toString('hex')
  const app = express()
  const identity = { repository: `${pull.owner}/${pull.repo}`, sha: lease.workspace.sha }
  let closed = false
  app.use((request, response, next) => {
    if (
      closed ||
      request.headers.authorization !== `Bearer ${token}` ||
      request.headers.origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(request.hostname)
    ) {
      response.sendStatus(403)
      return
    }
    next()
  })
  app.use(express.json({ limit: '64kb' }))
  const paths = [...lease.workspace.paths].sort()
  async function content(path: string) {
    if (!lease.workspace.paths.has(path))
      throw new Error('This path is not a regular file in the reviewed commit.')
    const target = workspacePath(lease.workspace.directory, path)
    if ((await stat(target)).size > 512 * 1024)
      throw new Error('File inspection supports text files up to 512 KiB.')
    const text = await readFile(target, 'utf8')
    if (text.includes('\0')) throw new Error('Binary files cannot be inspected as text.')
    return text
  }
  async function call(name: keyof typeof schemas, args: unknown) {
    if (name === 'list_files') {
      const { prefix, offset } = schemas.list_files.parse(args)
      const matched = paths.filter((path) => path.startsWith(prefix))
      return {
        ...identity,
        paths: matched.slice(offset, offset + 1000),
        nextOffset: matched.length > offset + 1000 ? offset + 1000 : null,
      }
    }
    if (name === 'read_file') {
      const { path, startLine, lines } = schemas.read_file.parse(args)
      // Read immutable Git blobs; language servers and agents cannot change evidence.
      const file = await project.file(pull, DiffSide.right, path)
      return {
        ...identity,
        path,
        lines: file.content
          .split('\n')
          .slice(startLine - 1, startLine - 1 + lines)
          .map((text, index) => ({ line: startLine + index, text })),
      }
    }
    if (name === 'search_text') {
      const { query, prefix } = schemas.search_text.parse(args)
      const matches: { path: string; line: number; text: string }[] = []
      const started = Date.now()
      let scannedBytes = 0
      let truncated = false
      for (const path of paths.filter((path) => path.startsWith(prefix))) {
        if (
          matches.length >= 200 ||
          scannedBytes >= 32 * 1024 * 1024 ||
          Date.now() - started > 10_000 ||
          closed
        ) {
          truncated = true
          break
        }
        let text: string
        try {
          text = await content(path)
        } catch {
          continue
        }
        scannedBytes += Buffer.byteLength(text)
        for (const [index, line] of text.split('\n').entries()) {
          if (line.includes(query))
            matches.push({ path, line: index + 1, text: line.slice(0, 1000) })
          if (matches.length >= 200) {
            truncated = true
            break
          }
        }
      }
      return {
        ...identity,
        matches,
        truncated,
        limits: '200 matches, 32 MiB of text, 10 seconds. Use a narrower prefix to continue.',
      }
    }
    const request = schemas[name].parse(args)
    const kind =
      name === 'go_to_definition'
        ? 'definition'
        : name === 'find_references'
          ? 'references'
          : 'implementation'
    const tree = await project.tree(pull, request.side)
    return {
      repository: identity.repository,
      sha: tree.sha,
      ...(await navigate(pull, { ...request, kind })),
    }
  }
  app.post('/mcp', async (request, response) => {
    const parsed = z
      .object({
        jsonrpc: z.literal('2.0'),
        id: z.union([z.number(), z.string()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC request.' },
      })
      return
    }
    const { id, method, params } = parsed.data
    if (id === undefined) {
      response.sendStatus(202)
      return
    }
    const reply = (result: unknown) => response.json({ jsonrpc: '2.0', id, result })
    try {
      if (method === 'initialize') {
        const { protocolVersion } = z.object({ protocolVersion: z.string() }).parse(params)
        reply({
          protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(protocolVersion)
            ? protocolVersion
            : '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'slopbusters-repository', version: '1.0.0' },
        })
      } else if (method === 'ping') reply({})
      else if (method === 'tools/list')
        reply({
          tools: Object.entries(schemas).map(([name, schema]) => ({
            name,
            description: descriptions[name as keyof typeof schemas],
            inputSchema: z.toJSONSchema(schema),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          })),
        })
      else if (method === 'tools/call') {
        const input = z
          .object({
            name: z.enum(
              Object.keys(schemas) as [keyof typeof schemas, ...(keyof typeof schemas)[]],
            ),
            arguments: z.unknown().default({}),
          })
          .parse(params)
        try {
          reply({
            content: [
              { type: 'text', text: JSON.stringify(await call(input.name, input.arguments)) },
            ],
          })
        } catch (error) {
          reply({
            isError: true,
            content: [
              { type: 'text', text: error instanceof Error ? error.message : 'Inspection failed.' },
            ],
          })
        }
      } else
        response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method.' } })
    } catch {
      response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid parameters.' } })
    }
  })
  app.all('/mcp', (_request, response) => response.sendStatus(405))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Could not start repository inspection tools.')
  return {
    directory: lease.workspace.directory,
    sha: lease.workspace.sha,
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    close: async () => {
      if (closed) return
      closed = true
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          error ? reject(error) : resolve()
        })
        server.closeAllConnections()
      })
      lease.release()
    },
  }
}
