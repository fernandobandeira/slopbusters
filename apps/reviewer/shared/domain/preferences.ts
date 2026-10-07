import { z } from 'zod'
import { Provider } from './types'

export const organizationSchema = z
  .object({
    provider: z.enum(Provider),
    model: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  })
  .strict()

export const preferencesSchema = z
  .object({
    theme: z.string().min(1).max(80).optional(),
    organization: organizationSchema.optional(),
    companion: organizationSchema.optional(),
    recentRepositories: z
      .array(
        z
          .string()
          .max(300)
          .regex(/^[\w.-]+\/[\w.-]+$/),
      )
      .max(10)
      .optional(),
  })
  .strict()

export type OrganizationPreferences = z.infer<typeof organizationSchema>
export type Preferences = z.infer<typeof preferencesSchema>

export const organizationDefaults: Record<Provider, { model: string; label: string }> = {
  [Provider.codex]: { model: 'gpt-6.1-sol', label: 'Sol 6.1' },
  [Provider.claude]: { model: 'claude-opus-5-5', label: 'Opus 5.5' },
}

export function providerLabel(provider: Provider) {
  return provider === Provider.codex ? 'Codex' : 'Claude'
}
