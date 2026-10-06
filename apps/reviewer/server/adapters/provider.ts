import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Provider } from '../../shared/domain/types'
import type { OrganizationPreferences } from '../../shared/domain/preferences'
import { runCodex, runClaude } from './providerCommands'
import type { RepositoryContext } from './repositoryTools'
import { providerOptions, type ProviderOptions } from './providerOptions'
export { providerOptions, type ProviderOptions } from './providerOptions'
import { providerEvents } from './providerEvents'

/** Reuse the signed-in CLI accounts for bounded, structured advisory calls. */
export async function runStructured<T>(
  { provider, model }: OrganizationPreferences,
  prompt: string,
  outputSchema: z.ZodType<T>,
  signal: AbortSignal,
  options?: ProviderOptions | RepositoryContext | { directory: string },
): Promise<T> {
  const { repository, observer, timeoutMs } = providerOptions(options)
  const events = providerEvents(provider, observer)
  observer?.({ id: 'prompt', kind: 'prompt', text: prompt, title: 'Instructions' })
  signal.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'slopbusters-'))
  try {
    const schema = JSON.stringify(z.toJSONSchema(outputSchema, { target: 'draft-7' }))
    const request = {
      directory,
      model,
      schema,
      prompt,
      signal,
      repository,
      observer,
      events,
      timeoutMs,
    }
    const output = provider === Provider.codex ? await runCodex(request) : await runClaude(request)
    events.finish()
    return outputSchema.parse(output)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
