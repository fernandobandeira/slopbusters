import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Provider } from '../shared/types'
import type { OrganizationPreferences } from '../shared/preferences'
import { runCommand } from './process'

/** Reuse the signed-in CLI accounts for bounded, structured advisory calls. */
export async function runStructured<T>(
  { provider, model }: OrganizationPreferences,
  prompt: string,
  outputSchema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'slopbusters-'))
  try {
    const schema = JSON.stringify(z.toJSONSchema(outputSchema, { target: 'draft-7' }))
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
            '--output-schema',
            schemaPath,
            '--output-last-message',
            resultPath,
            '-',
          ],
          input: prompt,
          cwd: directory,
          signal,
          timeoutMs: 300_000,
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
            '--safe-mode',
            '--tools',
            '',
            '--strict-mcp-config',
            '--permission-mode',
            'dontAsk',
            '--output-format',
            'json',
            '--json-schema',
            schema,
          ],
          input: prompt,
          cwd: directory,
          signal,
          timeoutMs: 300_000,
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
