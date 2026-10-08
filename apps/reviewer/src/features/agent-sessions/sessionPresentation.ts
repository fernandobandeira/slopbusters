import type { AgentSession } from '../../../shared/domain/agentSession'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { issuePath, reviewPath } from '../../lib/routes'

export const agentNames: Record<AgentSession['kind'], string> = {
  gandalf: 'Gandalf',
  bob: 'Uncle Bob',
  linus: 'Linus',
  grouping: 'Diff organization',
  jobs: 'Steve Jobs',
}
export function modelName(model: OrganizationPreferences) {
  if (model.model === 'gpt-6.1-sol') return 'Sol 6.1'
  if (model.model === 'claude-opus-5-5') return 'Opus 5.5'
  return model.model.replace(/^claude-/, '').replace(/-/g, ' ')
}
/** Where a session's subject opens: the PR it reviewed, or the Linear issue Jobs read. */
export function sessionSubject(
  kind: AgentSession['kind'],
  url?: string,
): { to: string; label: string; noun: string } | undefined {
  if (!url) return undefined
  if (kind === 'jobs') {
    const identifier = /\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(url)?.[1]?.toUpperCase()
    return identifier
      ? { to: issuePath(identifier), label: 'Open issue', noun: 'issue' }
      : undefined
  }
  return { to: reviewPath({ url, filter: 'mine' }), label: 'Open PR', noun: 'PR' }
}
export function sessionPath(id?: string, repository?: string) {
  const query = repository ? `?${new URLSearchParams({ repository })}` : ''
  return `/sessions${id ? `/${encodeURIComponent(id)}` : ''}${query}`
}
