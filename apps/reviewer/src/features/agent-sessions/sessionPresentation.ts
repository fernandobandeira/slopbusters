import type { AgentSession } from '../../../shared/domain/agentSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'

export const agentNames: Record<AgentSession['kind'], string> = {
  gandalf: 'Gandalf',
  bob: 'Uncle Bob',
  linus: 'Linus',
  grouping: 'Diff organization',
}
export function modelName(model: OrganizationPreferences) {
  if (model.model === 'gpt-6.1-sol') return 'Sol 6.1'
  if (model.model === 'claude-opus-5-5') return 'Opus 5.5'
  return model.model.replace(/^claude-/, '').replace(/-/g, ' ')
}
export function sessionPath(id?: string, repository?: string) {
  const query = repository ? `?${new URLSearchParams({ repository })}` : ''
  return `/sessions${id ? `/${encodeURIComponent(id)}` : ''}${query}`
}
