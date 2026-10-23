import type { AgentSession } from '../../../shared/domain/agentSession'
import { providerModels, type OrganizationPreferences } from '../../../shared/domain/preferences'
import { issuePath, reviewPath } from '../../lib/routes'

export const agentNames: Record<AgentSession['kind'], string> = {
  gandalf: 'Gandalf',
  bob: 'Uncle Bob',
  linus: 'Linus',
  grouping: 'Diff organization',
  jobs: 'Steve Jobs',
  panel: 'Review panel',
}
/** The model's short name, such as "Astra 6"; a model the app no longer runs shows its id. */
export function modelName(model: OrganizationPreferences) {
  const known = Object.values(providerModels)
    .flatMap((roles) => Object.values(roles))
    .find((item) => item.model === model.model)
  return known?.label ?? model.model.replace(/^claude-/, '').replace(/-/g, ' ')
}
/**
 * Where a session's subject opens: the PR it reviewed, the panel on that PR, which shows a panel
 * still running, or the Linear issue Jobs read.
 */
export function sessionSubject(
  session: Pick<AgentSession, 'id' | 'kind'>,
  url?: string,
): { to: string; label: string; noun: string } | undefined {
  const { kind } = session
  if (!url) return undefined
  if (kind === 'jobs') {
    const identifier = /\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(url)?.[1]?.toUpperCase()
    return identifier
      ? { to: issuePath(identifier), label: 'Open issue', noun: 'issue' }
      : undefined
  }
  if (kind === 'panel')
    return {
      to: reviewPath({ url, filter: 'mine', panel: session.id }),
      label: 'Open panel',
      noun: 'PR',
    }
  return { to: reviewPath({ url, filter: 'mine' }), label: 'Open PR', noun: 'PR' }
}
export function sessionPath(id?: string, repository?: string) {
  const query = repository ? `?${new URLSearchParams({ repository })}` : ''
  return `/sessions${id ? `/${encodeURIComponent(id)}` : ''}${query}`
}
