import type { RepositoryContext } from './repositoryTools'
import type { ProviderObserver } from '../../shared/domain/agentSession'

export interface ProviderOptions {
  repository?: RepositoryContext | { directory: string }
  observer?: ProviderObserver
}
export function providerOptions(
  options?: ProviderOptions | RepositoryContext | { directory: string },
): ProviderOptions {
  return options && 'directory' in options ? { repository: options } : (options ?? {})
}
