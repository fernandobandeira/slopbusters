import { AgentSessionStore } from './adapters/agentSessionStore'
import { AgentSessions } from './features/agent-sessions/agentSessions'
import { ReviewerStore } from './adapters/store'
import { createGitHub, type GitHub } from './adapters/github'
import { createPullService } from './features/pulls/github'
import { createPullStatusService } from './features/pulls/pullStatus'
import { createStackService } from './features/pulls/stacks'
import { createRevisionChecker } from './features/pulls/updates'
import {
  createFileContentLoader,
  createSourceProjectLoader,
} from './features/navigation/fileContent'
import { LocalSourceRepository } from './adapters/sourceRepository'
import { ReviewWorkspaces } from './adapters/reviewWorkspaces'
import { LanguageServers } from './adapters/languageServers'
import { LanguageServerNavigation } from './adapters/lspNavigation'
import {
  WorkspaceTypeScriptNavigation,
  type TypeScriptWorkerOptions,
} from './adapters/workspaceNavigation'
import { createSourceNavigator } from './features/navigation/navigation'
import { configureSourceAssetsDirectory } from './adapters/treeSymbols'
import { BobJobs } from './features/bob/bobJobs'
import { LinusJobs } from './features/linus/linusJobs'
import { startRepositoryTools } from './adapters/repositoryTools'
import { OrganizationJobs } from './features/organizationJobs'
import { GandalfJobs } from './features/gandalf/gandalfJobs'
import { createGandalfPlanner } from './features/gandalf/gandalfPlan'
import { openConflictWorkspace } from './adapters/conflictWorkspace'
import { logError } from './errors'
import { createMergeBaseLookup } from './features/pulls/mergeBase'
import type { PullRequest } from '../shared/domain/types'

export interface ReviewerServerOptions extends TypeScriptWorkerOptions {
  dataDirectory: string
  staticDirectory: string
  sourceAssetsDirectory?: string
  bobSkillDirectory?: string
  linusSkillDirectory?: string
  port?: number
  allowedOrigins?: string[]
  sourceRemoteUrl?: (owner: string, repo: string) => string
  github?: GitHub
}

export function createServices(options: ReviewerServerOptions) {
  configureSourceAssetsDirectory(options.sourceAssetsDirectory)
  const store = new ReviewerStore(options)
  const agentSessions = new AgentSessions(new AgentSessionStore(options.dataDirectory))
  const github = options.github ?? createGitHub()
  const statuses = createPullStatusService(github)
  const stacks = createStackService(github, statuses)
  const repository = new LocalSourceRepository(options.dataDirectory, options.sourceRemoteUrl)
  const pulls = createPullService(github, stacks, repository, (id) => store.getPull(id))
  const checkRevision = createRevisionChecker(pulls.fetchPullRevision)
  const mergeBase = createMergeBaseLookup(github)
  const loadFileContent = createFileContentLoader(repository, github, mergeBase)
  const sourceProject = createSourceProjectLoader(repository, github, mergeBase)
  const workspaces = new ReviewWorkspaces(options.dataDirectory, repository)
  const languageServers = new LanguageServers(options.dataDirectory)
  let languageNavigation = new LanguageServerNavigation(sourceProject, languageServers, workspaces)
  let typeScriptNavigation = new WorkspaceTypeScriptNavigation(sourceProject, workspaces, options)
  let navigator = createSourceNavigator(sourceProject, languageNavigation, typeScriptNavigation)
  const openRepository = repositoryOpener({
    workspaces,
    sourceProject,
    navigate: (pull, request) => navigator(pull, request),
  })
  const linusJobs = new LinusJobs(
    store,
    options.staticDirectory,
    options.linusSkillDirectory,
    openRepository,
    pulls.fetchPull,
    agentSessions,
  )
  const bobJobs = new BobJobs({
    store,
    sessions: agentSessions,
    staticDirectory: options.staticDirectory,
    skillDirectory: options.bobSkillDirectory,
    openRepository,
    loadPull: pulls.fetchPull,
  })
  const conflictRemote = options.sourceRemoteUrl
  const gandalfJobs = new GandalfJobs({
    store,
    sessions: agentSessions,
    loadPull: pulls.fetchPull,
    plan: createGandalfPlanner(stacks.getStackMetadata),
    openWorkspace: (pull, signal) =>
      openConflictWorkspace({
        dataDirectory: options.dataDirectory,
        pull,
        github,
        signal,
        remoteUrl: conflictRemote
          ? (name) => {
              const [owner, repo] = name.split('/')
              if (!owner || !repo) throw new Error('Invalid source repository.')
              return conflictRemote(owner, repo)
            }
          : undefined,
      }),
  })
  const organizationJobs = new OrganizationJobs(store, agentSessions)
  return {
    store,
    github,
    pulls,
    statuses,
    stacks,
    checkRevision,
    loadFileContent,
    sourceProject,
    workspaces,
    languageServers,
    linusJobs,
    bobJobs,
    gandalfJobs,
    agentSessions,
    organizationJobs,
    navigateSource: (pull: PullRequest, request: Parameters<typeof navigator>[1]) =>
      navigator(pull, request),
    warmSource: (pull: PullRequest) => {
      warmSource(repository, pull)
    },
    async removeWorkspace(identity: { owner: string; repo: string; sha: string }) {
      await typeScriptNavigation.closeRevision(identity.owner, identity.repo, identity.sha)
      await languageNavigation.closeRevision(identity.owner, identity.repo, identity.sha)
      await workspaces.remove(identity, identity.sha)
      navigator.clearCache()
    },
    async saveLanguageServers(configuration: Parameters<LanguageServers['save']>[0]) {
      await languageServers.save(configuration)
      await Promise.all([languageNavigation.close(), typeScriptNavigation.close()])
      navigator.close()
      languageNavigation = new LanguageServerNavigation(sourceProject, languageServers, workspaces)
      typeScriptNavigation = new WorkspaceTypeScriptNavigation(sourceProject, workspaces, options)
      navigator = createSourceNavigator(sourceProject, languageNavigation, typeScriptNavigation)
      return languageServers.statuses()
    },
    async close() {
      await organizationJobs.close()
      await Promise.all([linusJobs.close(), bobJobs.close(), gandalfJobs.close()])
      await Promise.all([languageNavigation.close(), typeScriptNavigation.close()])
      navigator.close()
      await workspaces.close()
      await repository.close()
      agentSessions.store.close()
      store.close()
    },
  }
}
export type Services = ReturnType<typeof createServices>

function repositoryOpener(options: {
  workspaces: ReviewWorkspaces
  sourceProject: ReturnType<typeof createSourceProjectLoader>
  navigate: Parameters<typeof startRepositoryTools>[3]
}) {
  return async (pull: PullRequest, signal: AbortSignal) => {
    signal.throwIfAborted()
    const lease = await options.workspaces.acquire(pull, pull.headSha)
    try {
      signal.throwIfAborted()
      return await startRepositoryTools(pull, lease, options.sourceProject, options.navigate)
    } catch (error) {
      lease.release()
      throw error
    }
  }
}

function warmSource(repository: LocalSourceRepository, pull: PullRequest) {
  for (const sha of new Set(
    [pull.headSha, pull.mergeBaseSha].filter((sha): sha is string => Boolean(sha)),
  ))
    void repository.tree(pull.owner, pull.repo, sha).catch((error: unknown) => {
      logError('Warming source cache', error)
    })
}
