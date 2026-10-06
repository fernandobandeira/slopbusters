import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { PROVIDER_TIMEOUT_MS } from '../limits'
import { runCommand } from './process'
import type { ProviderOptions } from './providerOptions'
import type { providerEvents } from './providerEvents'

type Request = ProviderOptions & {
  directory: string
  model: string
  schema: string
  prompt: string
  signal: AbortSignal
  events: ReturnType<typeof providerEvents>
}

export async function runCodex({
  directory,
  model,
  schema,
  prompt,
  signal,
  repository,
  observer,
  events,
}: Request) {
  const inspection = repository && 'url' in repository ? repository : undefined

  const schemaPath = join(directory, 'schema.json')
  const resultPath = join(directory, 'result.json')
  await writeFile(schemaPath, schema)
  await runCommand({
    command: 'codex',
    args: [
      'exec',
      '--json',
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
    onStdout: observer ? events.write : undefined,
  })
  return JSON.parse(await readFile(resultPath, 'utf8')) as unknown
}

export async function runClaude({
  directory,
  model,
  schema,
  prompt,
  signal,
  repository,
  observer,
  events,
}: Request) {
  const inspection = repository && 'url' in repository ? repository : undefined

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
      observer ? 'stream-json' : 'json',
      ...(observer ? ['--verbose', '--include-partial-messages'] : []),
      '--json-schema',
      schema,
    ],
    input: prompt,
    cwd: repository?.directory ?? directory,
    signal,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    onStdout: observer ? events.write : undefined,
  })
  if (observer) return events.finish()
  else {
    const envelope = z.object({ structured_output: z.unknown() }).parse(JSON.parse(text))
    return envelope.structured_output
  }
}
