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
    /** The primary provider. Its saved model is ignored; every feature runs `providerModels`. */
    organization: organizationSchema.optional(),
    /** Saved by earlier versions, when the companion was configurable; ignored. */
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

/**
 * The models every feature runs, which are not configurable: a review model for seats, chats and
 * the dual reviewers, and a stronger judge model for grounding findings against the code.
 */
export const providerModels: Record<
  Provider,
  Record<ModelRole, { model: string; label: string }>
> = {
  [Provider.codex]: {
    review: { model: 'gpt-6.1-sol', label: 'Sol 6.1' },
    judge: { model: 'gpt-6-astra', label: 'Astra 6' },
  },
  [Provider.claude]: {
    review: { model: 'claude-opus-5-5', label: 'Opus 5.5' },
    judge: { model: 'claude-fable-5-1', label: 'Fable 5.1' },
  },
}

export type ModelRole = 'review' | 'judge'

/** One model per provider: the primary provider's, and the other provider's as companion. */
export interface ModelPair {
  primary: OrganizationPreferences
  companion: OrganizationPreferences
}

export function providerLabel(provider: Provider) {
  return provider === Provider.codex ? 'Codex' : 'Claude'
}

export function otherProvider(provider: Provider) {
  return provider === Provider.codex ? Provider.claude : Provider.codex
}

/** The model `provider` runs in `role`. */
export function modelFor(provider: Provider, role: ModelRole = 'review'): OrganizationPreferences {
  return { provider, model: providerModels[provider][role].model }
}

/** The pair a feature runs in `role`, led by the primary provider. */
export function modelPair(primary: Provider, role: ModelRole = 'review'): ModelPair {
  return { primary: modelFor(primary, role), companion: modelFor(otherProvider(primary), role) }
}

/** Saved preferences as the app runs them: the primary's fixed model, and no legacy companion. */
export function withFixedModels(preferences: Preferences): Preferences {
  const { companion: _legacy, ...current } = preferences
  return current.organization
    ? { ...current, organization: modelFor(current.organization.provider) }
    : current
}
