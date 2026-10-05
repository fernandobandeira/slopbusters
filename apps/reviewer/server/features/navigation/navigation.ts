import type { NavigationRequest, NavigationResult } from '../../../shared/domain/navigation'
import type { PullRequest } from '../../../shared/domain/types'
import type { createSourceProjectLoader } from './fileContent'
import type { LanguageServerNavigation } from '../../adapters/lspNavigation'
import type { WorkspaceTypeScriptNavigation } from '../../adapters/workspaceNavigation'
import { sourceLanguage } from '../../adapters/treeSymbols'
import { createSnapshotNavigator } from './snapshotNavigation'
import { createCache } from '../../cache'
import { publicError } from '../../errors'

/** Choose the installed semantic provider, then fall back to a bounded immutable snapshot. */
export function createSourceNavigator(
  project: ReturnType<typeof createSourceProjectLoader>,
  languageServers?: LanguageServerNavigation,
  localTypeScript?: WorkspaceTypeScriptNavigation,
) {
  const snapshot = createSnapshotNavigator(project)
  const cache = createCache<NavigationResult>({
    max: 40,
    cacheable: (value) =>
      (!languageServers || value.mode === 'semantic') &&
      !value.warnings.some((warning) =>
        warning.startsWith('Full-project navigation is unavailable:'),
      ),
  })

  async function navigate(
    pull: PullRequest,
    request: NavigationRequest,
  ): Promise<NavigationResult> {
    const language = sourceLanguage(request.path)
    const semantic = language === 'typescript' || language === 'javascript'
    const warnings: string[] = []
    if (semantic && localTypeScript) {
      try {
        return await localTypeScript.navigate(pull, request)
      } catch (error) {
        warnings.push(
          `Full-project navigation is unavailable: ${publicError(error, 'Local source could not be prepared.')} Using the saved source snapshot.`,
        )
      }
    }
    if (!semantic && languageServers) {
      const result = await languageServers.navigate(pull, request)
      if (result?.mode === 'semantic') return result
      warnings.push(...(result?.warnings ?? []))
    }
    if (!semantic && request.kind === 'implementation')
      return {
        language,
        mode: 'text',
        targets: [],
        warnings: [
          ...warnings,
          'Implementation lookup requires a language server that supports it. Configure the language server in Settings.',
        ],
      }
    const result = await snapshot(pull, request)
    return { ...result, warnings: [...warnings, ...result.warnings] }
  }
  function sourceNavigation(pull: PullRequest, request: NavigationRequest) {
    const key = JSON.stringify([
      pull.owner,
      pull.repo,
      pull.baseSha,
      pull.headSha,
      pull.mergeBaseSha,
      request,
    ])
    return cache.load(key, () => navigate(pull, request))
  }
  return Object.assign(sourceNavigation, {
    clearCache: () => {
      cache.clear()
    },
    close() {
      snapshot.close()
      cache.clear()
    },
  })
}
