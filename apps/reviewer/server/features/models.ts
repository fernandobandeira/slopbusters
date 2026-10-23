import {
  modelPair,
  type ModelPair,
  type ModelRole,
  type Preferences,
} from '../../shared/domain/preferences'
import { UserError } from '../errors'

/** The fixed models for `role`, led by the provider chosen in Settings. */
export function savedModels(preferences: Preferences, role: ModelRole = 'review'): ModelPair {
  const provider = preferences.organization?.provider
  if (!provider) throw new UserError('Choose your primary provider in Settings first.')
  return modelPair(provider, role)
}
