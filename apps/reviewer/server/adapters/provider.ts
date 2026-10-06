import { PROVIDER_TIMEOUT_MS } from '../limits'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Provider } from '../../shared/domain/types'
import type { OrganizationPreferences } from '../../shared/domain/preferences'
import { runCommand } from './process'
import type { RepositoryContext } from './repositoryTools'

/** Reuse the signed-in CLI accounts for bounded, structured advisory calls. */
export async function runStructured<T>(
  { provider, model }: OrganizationPreferences,
  prompt: string,
  outputSchema: z.ZodType<T>,
  signal: AbortSignal,
  repository?: RepositoryContext | { directory: string },
): Promise<T> {
  signal.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'slopbusters-'))
  try {
    const schema = JSON.stringify(z.toJSONSchema(outputSchema, { target: 'draft-7' }))
    const inspection = repository && 'url' in repository ? repository : undefined
    let output: unknown
    switch (provider) {
      case Provider.codex: {
        const schemaPath = join(directory, 'schema.json')
        const resultPath = join(directory, 'result.json')
        await writeFile(schemaPath, schema)
        await runCommand({
          command: 'codex',
          args: [
            'exec',
            '--model',
            model,
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            ...(inspection
              ? [
                  '-c',
                  `mcp_servers.slopbusters.url=${JSON.stringify(inspection.url)}`,
                  '-c',
                  `mcp_servers.slopbusters.http_headers={Authorization=${JSON.stringify(`Bearer ${inspection.token}`)}}`,
                  '-c',
                  'mcp_servers.slopbusters.required=true',
                  '-c',
                  'mcp_servers.slopbusters.tool_timeout_sec=120',
                ]
              : []),
            '--output-schema',
            schemaPath,
            '--output-last-message',
            resultPath,
            '-',
          ],
          input: prompt,
          cwd: repository?.directory ?? directory,
          signal,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        })
        output = JSON.parse(await readFile(resultPath, 'utf8'))
        break
      }
      case Provider.claude: {
        const text = await runCommand({
          command: 'claude',
          args: [
            '-p',
            '--model',
            model,
            ...(repository
              ? [
                  '--setting-sources',
                  '',
                  ...(inspection
                    ? [
                        '--mcp-config',
                        JSON.stringify({
                          mcpServers: {
                            slopbusters: {
                              type: 'http',
                              url: inspection.url,
                              headers: { Authorization: `Bearer ${inspection.token}` },
                            },
                          },
                        }),
                      ]
                    : []),
                  '--allowedTools',
                  'Read',
                  'Glob',
                  'Grep',
                  'mcp__slopbusters__*',
                ]
              : ['--safe-mode']),
            '--tools',
            repository ? 'Read,Glob,Grep' : '',
            '--strict-mcp-config',
            '--permission-mode',
            'dontAsk',
            '--output-format',
            'json',
            '--json-schema',
            schema,
          ],
          input: prompt,
          cwd: repository?.directory ?? directory,
          signal,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        })
        const envelope = z.object({ structured_output: z.unknown() }).parse(JSON.parse(text))
        output = envelope.structured_output
        break
      }
    }
    return outputSchema.parse(output)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
