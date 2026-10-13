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
import { ReviewWorkspaces, type ReviewCheckout } from './adapters/reviewWorkspaces'
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
import { OrganizationJobs } from './features/organizationJobs'
import { GandalfJobs } from './features/gandalf/gandalfJobs'
import { createGandalfPlanner } from './features/gandalf/gandalfPlan'
import { openConflictWorkspace } from './adapters/conflictWorkspace'
import { loadCiFailures } from './adapters/ciFailures'
import { createGitIdentity } from './adapters/gitIdentity'
import { logError, UserError } from './errors'
import { createMergeBaseLookup } from './features/pulls/mergeBase'
import type { PullRequest } from '../shared/domain/types'
import { LinearAuth } from './adapters/linearAuth'
import { createLinear, type Linear } from './adapters/linear'
import { createTicketService } from './features/tickets/tickets'
import { defaultBranchSnapshot } from './features/tickets/defaultBranch'
import { ticketEvidence } from './features/jobs/ticketEvidence'
import { TicketReviewJobs } from './features/jobs/ticketReviewJobs'
import { LINEAR_CLIENT_ID } from './linearApplication'
import { createEngines, type BundledEngineSettings } from './adapters/t3Engine/engines'
import type { StructuredTurns } from './adapters/t3Engine/engineTurns'
import type { ChatHosts } from './adapters/t3Engine/chatHosts'
import { continueInT3Code } from './features/chat/personaChats'
import type { ContinueChatRequest } from '../shared/domain/chat'

export interface ReviewerServerOptions extends TypeScriptWorkerOptions {
  dataDirectory: string
  staticDirectory: string
  sourceAssetsDirectory?: string
  bobSkillDirectory?: string
  linusSkillDirectory?: string
  jobsSkillDirectory?: string
  port?: number
  allowedOrigins?: string[]
  sourceRemoteUrl?: (owner: string, repo: string) => string
  github?: GitHub
  linear?: Linear
  linearClientId?: string
  linearCallbackPort?: number
  /** The T3 Code engine Slopbusters ships, for chats the user's T3 Code cannot take. */
  bundledEngine?: BundledEngineSettings
  /** Where chats run; replaced in tests. */
  chatHosts?: ChatHosts
  /** Where persona reviews, grouping and Gandalf run their agent turns; replaced in tests. */
  structuredTurns?: StructuredTurns
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
  const openRepository = checkoutOpener(workspaces)
  const engines = createEngines({
    credentials: store.engine,
    dataDirectory: options.dataDirectory,
    bundled: options.bundledEngine,
  })
  const chatHosts = options.chatHosts ?? engines.hosts
  const turns = options.structuredTurns ?? engines.turns ?? withoutEngine
  const linearAuth = new LinearAuth(store.tickets, {
    clientId: options.linearClientId ?? LINEAR_CLIENT_ID,
    callbackPort: options.linearCallbackPort,
  })
  const linear = options.linear ?? createLinear({ authorization: linearAuth })
  const tickets = createTicketService(linear, github)
  const linusJobs = new LinusJobs({
    store,
    turns,
    sessions: agentSessions,
    staticDirectory: options.staticDirectory,
    skillDirectory: options.linusSkillDirectory,
    openRepository,
    loadPull: pulls.fetchPull,
    context: tickets.contextForPull,
  })
  const bobJobs = new BobJobs({
    store,
    turns,
    sessions: agentSessions,
    staticDirectory: options.staticDirectory,
    skillDirectory: options.bobSkillDirectory,
    openRepository,
    loadPull: pulls.fetchPull,
    context: tickets.contextForPull,
  })
  const jobs = new TicketReviewJobs({
    store,
    turns,
    sessions: agentSessions,
    staticDirectory: options.staticDirectory,
    skillDirectory: options.jobsSkillDirectory,
    tickets,
    evidence: (ticket, signal) => ticketEvidence(github, ticket, signal),
    openSource: async (name, signal) =>
      openRepository(await defaultBranchSnapshot(github, name, signal), signal),
  })
  const conflictRemote = options.sourceRemoteUrl
  const gitIdentity = createGitIdentity(github)
  const gandalfJobs = new GandalfJobs({
    store,
    turns,
    sessions: agentSessions,
    loadPull: pulls.fetchPull,
    plan: createGandalfPlanner(stacks.getStackMetadata),
    loadFailures: (pull, signal) => loadCiFailures(github, pull, signal),
    openWorkspace: (pull, signal, task) =>
      openConflictWorkspace({
        dataDirectory: options.dataDirectory,
        pull,
        github,
        signal,
        task,
        identity: gitIdentity,
        remoteUrl: conflictRemote
          ? (name) => {
              const [owner, repo] = name.split('/')
              if (!owner || !repo) throw new Error('Invalid source repository.')
              return conflictRemote(owner, repo)
            }
          : undefined,
      }),
  })
  const organizationJobs = new OrganizationJobs(store, turns, agentSessions)
  const chatModel = () => {
    const model = store.getPreferences().organization
    if (!model) throw new UserError('Choose your primary model in Settings first.')
    return model
  }
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
    linearAuth,
    tickets,
    jobs,
    chats: {
      continueInT3Code: (request: ContinueChatRequest) =>
        continueInT3Code(chatHosts, {
          sessions: { linus: linusJobs, bob: bobJobs, jobs, gandalf: gandalfJobs },
          model: chatModel(),
          request,
        }),
    },
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
      linearAuth.close()
      await Promise.all([linusJobs.close(), bobJobs.close(), gandalfJobs.close(), jobs.close()])
      await Promise.all([languageNavigation.close(), typeScriptNavigation.close()])
      navigator.close()
      await workspaces.close()
      await engines.close()
      await repository.close()
      agentSessions.store.close()
      store.close()
    },
  }
}
export type Services = ReturnType<typeof createServices>

/** Agent turns for a build without the bundled engine: every run fails with a reason. */
const withoutEngine: StructuredTurns = {
  run: () =>
    Promise.reject(
      new UserError(
        'This build of Slopbusters does not include the T3 Code engine, so it cannot run agents.',
      ),
    ),
}

/** Lease the review checkout of a PR's head; agents read it until the lease is released. */
function checkoutOpener(workspaces: ReviewWorkspaces) {
  return async (pull: PullRequest, signal: AbortSignal): Promise<ReviewCheckout> => {
    signal.throwIfAborted()
    const lease = await workspaces.acquire(pull, pull.headSha)
    if (signal.aborted) {
      lease.release()
      signal.throwIfAborted()
    }
    const { directory, sha } = lease.workspace
    return { directory, sha, release: lease.release }
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
