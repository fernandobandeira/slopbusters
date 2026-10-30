import { join } from 'node:path'
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
import { prepareFixWorktree } from './adapters/fixWorktrees'
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
import { savedModels } from './features/models'
import { createGandalfJobs } from './features/gandalf/createGandalfJobs'
import { createGitIdentity } from './adapters/gitIdentity'
import { createSplitJobs } from './features/split/createSplitJobs'
import { logError, UserError } from './errors'
import { REVIEW_CHECKOUT_PRUNE_INTERVAL_MS, REVIEW_CHECKOUT_RETENTION_MS } from './limits'
import { fetchDiscussions, fetchReviewBodies } from './features/pulls/discussions'
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
import { defaultSkillRoots, InstalledSkills, type SkillRoots } from './adapters/installedSkills'
import { TeammateStore } from './adapters/teammateStore'
import { Teammates } from './features/teammates/teammates'
import { PanelMembers } from './features/panel/panelMembers'
import { PanelJobs } from './features/panel/panelJobs'
import { RetryingTurns } from './adapters/t3Engine/retryingTurns'
import { PanelFixes } from './features/panel/panelFixes'
import { FixChecks } from './features/panel/fixCheck'
import { localSnapshotLoader } from './features/panel/localRound'
import { PanelGates } from './features/panel/panelGates'
import { PanelRoutes } from './features/panel/panelRoutes'
import { loadBuiltInSkill } from './features/panel/builtInSkills'

export interface ReviewerServerOptions extends TypeScriptWorkerOptions {
  dataDirectory: string
  staticDirectory: string
  sourceAssetsDirectory?: string
  bobSkillDirectory?: string
  linusSkillDirectory?: string
  jobsSkillDirectory?: string
  terminatorSkillDirectory?: string
  /** Where Claude Code and Codex keep the user's own skills; replaced in tests. */
  skillRoots?: SkillRoots
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
    // The panel is composed below; Linus only starts one once a review has run.
    panels: {
      start: (repository, urls, reviewers) => panelJobs.start(repository, urls, reviewers),
    },
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
  const remoteUrl = sourceRemote(options.sourceRemoteUrl)
  const gitIdentity = createGitIdentity(github)
  const gandalfJobs = createGandalfJobs({
    store,
    turns,
    sessions: agentSessions,
    github,
    identity: gitIdentity,
    dataDirectory: options.dataDirectory,
    loadPull: pulls.fetchPull,
    getStack: stacks.getStackMetadata,
    remoteUrl,
  })
  const splitJobs = createSplitJobs({
    store,
    turns: new RetryingTurns(turns),
    sessions: agentSessions,
    github,
    identity: gitIdentity,
    staticDirectory: options.staticDirectory,
    skillDirectory: options.linusSkillDirectory,
    dataDirectory: options.dataDirectory,
    loadPull: pulls.fetchPull,
    remoteUrl,
  })
  const organizationJobs = new OrganizationJobs(store, turns, agentSessions)
  const teammates = new Teammates(
    new TeammateStore(options.dataDirectory),
    new InstalledSkills(options.skillRoots ?? defaultSkillRoots()),
  )
  const panelMembers = new PanelMembers({
    teammates,
    builtIn: (reviewer) => loadBuiltInSkill(reviewer, options),
  })
  const loadLocal = localSnapshotLoader(repository, pulls.fetchPull)
  const panelJobs = new PanelJobs({
    store: store.panel,
    // A batch of panels outlasts an engine restart or a busy provider; retry those turns first.
    turns: new RetryingTurns(turns),
    sessions: agentSessions,
    members: panelMembers,
    models: () => savedModels(store.getPreferences()),
    judges: () => savedModels(store.getPreferences(), 'judge'),
    loadPull: pulls.fetchPull,
    loadLocal,
    stack: (url) => stacks.getStackMetadata(url),
    history: async (pull) => {
      const [discussions, reviews] = await Promise.all([
        fetchDiscussions(pull, github),
        fetchReviewBodies(pull, github),
      ])
      return { threads: discussions.threads, reviews }
    },
    openRepository,
    context: tickets.contextForPull,
  })
  const panelGates = new PanelGates({
    store: store.panel,
    turns,
    judges: () => savedModels(store.getPreferences(), 'judge'),
    sessions: agentSessions,
    openRepository,
  })
  const panelRoutes = new PanelRoutes({
    store: store.panel,
    turns,
    jobs: panelJobs,
    judges: () => savedModels(store.getPreferences(), 'judge'),
    sessions: agentSessions,
  })
  const fixChecks = new FixChecks({
    store: store.panel,
    turns,
    checker: () => savedModels(store.getPreferences()).companion,
    loadLocal,
    openRepository,
    sessions: agentSessions,
  })
  const chatModel = () => savedModels(store.getPreferences()).primary
  const panelFixes = new PanelFixes({
    store: store.panel,
    hosts: chatHosts,
    loadPull: pulls.fetchPull,
    model: chatModel,
    jobs: panelJobs,
    prepareWorktree: (checkout, pull, sha) =>
      prepareFixWorktree(checkout, pull, sha, {
        root: join(options.dataDirectory, 'fix-worktrees'),
        remoteUrl: options.sourceRemoteUrl,
      }),
    sessions: agentSessions,
  })
  const removeWorkspace = async (identity: { owner: string; repo: string; sha: string }) => {
    await typeScriptNavigation.closeRevision(identity.owner, identity.repo, identity.sha)
    await languageNavigation.closeRevision(identity.owner, identity.repo, identity.sha)
    await workspaces.remove(identity, identity.sha)
    navigator.clearCache()
  }
  const pruning = pruneUnusedCheckouts(workspaces, removeWorkspace)
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
    splitJobs,
    agentSessions,
    organizationJobs,
    linearAuth,
    tickets,
    jobs,
    teammates,
    panelJobs,
    panelGates,
    panelFixes,
    panelRoutes,
    fixChecks,
    chats: {
      continueInT3Code: async (request: ContinueChatRequest) => {
        const model = chatModel()
        if (request.persona === 'panel') {
          const reviewer = panelJobs
            .get(request.sessionId)
            .reviewers.find((member) => member.id === request.reviewer)
          if (reviewer) await panelMembers.requireChat(reviewer, model.provider)
        }
        return continueInT3Code(chatHosts, {
          sessions: {
            linus: linusJobs,
            bob: bobJobs,
            jobs,
            gandalf: gandalfJobs,
            panel: panelJobs,
          },
          model,
          request,
        })
      },
    },
    navigateSource: (pull: PullRequest, request: Parameters<typeof navigator>[1]) =>
      navigator(pull, request),
    warmSource: (pull: PullRequest) => {
      warmSource(repository, pull)
    },
    removeWorkspace,
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
      await Promise.all([
        linusJobs.close(),
        bobJobs.close(),
        gandalfJobs.close(),
        splitJobs.close(),
        jobs.close(),
        panelJobs.close(),
      ])
      await pruning.stop()
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
/** Where a repository's Git remote is, for tests that point workspaces at a local one. */
function sourceRemote(
  sourceRemoteUrl?: (owner: string, repo: string) => string,
): ((repository: string) => string) | undefined {
  if (!sourceRemoteUrl) return undefined
  return (name) => {
    const [owner, repo] = name.split('/')
    if (!owner || !repo) throw new Error('Invalid source repository.')
    return sourceRemoteUrl(owner, repo)
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

/**
 * Remove review checkouts unused for a week, at startup and every few hours. A checkout in use
 * or with changes is kept.
 */
function pruneUnusedCheckouts(
  workspaces: ReviewWorkspaces,
  remove: (checkout: { owner: string; repo: string; sha: string }) => Promise<void>,
) {
  let running: Promise<void> = Promise.resolve()
  let stopped = false
  const prune = async () => {
    await workspaces.removeAbandoned()
    for (const checkout of await workspaces.unused(Date.now() - REVIEW_CHECKOUT_RETENTION_MS)) {
      if (stopped) return
      // A checkout in use or with changes stays; anything else unexpected is logged.
      await remove(checkout).catch((error: unknown) => {
        if (!(error instanceof UserError))
          logError('Could not remove an unused review checkout.', error)
      })
    }
  }
  const run = () => {
    running = running.then(prune).catch((error: unknown) => {
      logError('Could not remove unused review checkouts.', error)
    })
  }
  run()
  const timer = setInterval(run, REVIEW_CHECKOUT_PRUNE_INTERVAL_MS)
  timer.unref()
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
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
    const { directory, sha, paths } = lease.workspace
    return { directory, sha, paths, release: lease.release }
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
