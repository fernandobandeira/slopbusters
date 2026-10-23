import { randomUUID } from 'node:crypto'
import type { ChatHosts } from '../../adapters/t3Engine/chatHosts'
import { chatSeed, type ChatSeed, type ReviewSessions } from './chatSeeds'
import type { Chat, ContinueChatRequest } from '../../../shared/domain/chat'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { Provider } from '../../../shared/domain/types'

const MAX_TITLE_CHARACTERS = 80

export interface ContinueChat {
  readonly sessions: ReviewSessions
  readonly model: OrganizationPreferences
  readonly request: ContinueChatRequest
}

/**
 * Carry a review that ran in Slopbusters on as a T3 Code thread. The first message hands the
 * persona its own review and waits for the user. PR personas work in a worktree of the PR head
 * linked to the PR; Jobs works in the repository checkout.
 */
export async function continueInT3Code(
  hosts: ChatHosts,
  { sessions, model, request }: ContinueChat,
): Promise<Chat> {
  const seed = chatSeed(sessions, request)
  return seed.kind === 'pull'
    ? startPullThread(hosts, model, seed)
    : startRepositoryThread(hosts, model, seed)
}

async function startPullThread(
  hosts: ChatHosts,
  model: OrganizationPreferences,
  seed: Extract<ChatSeed, { kind: 'pull' }>,
): Promise<Chat> {
  const { pull } = seed
  const workspace = await hosts.workspaceFor(pull)
  const threadId = randomUUID()
  const prepared = await workspace.threads.preparePullRequest({
    cwd: workspace.project.workspaceRoot,
    url: pull.url,
    threadId,
    headSha: pull.headSha,
  })
  const title = chatTitle(seed.title)
  await workspace.threads.startThread({
    threadId,
    projectId: workspace.project.id,
    title,
    model: engineModel(model),
    branch: prepared.branch,
    worktreePath: prepared.worktreePath,
    pullRequest: {
      host: 'github.com',
      repository: `${pull.owner}/${pull.repo}`,
      number: pull.number,
      url: pull.url,
    },
    message: seed.message(model.provider, prepared),
  })
  await workspace.open(threadId)
  return {
    threadId,
    title,
    project: workspace.project.title,
    location: workspace.location,
    onPullRequestHead: prepared.onPullRequestHead,
  }
}

async function startRepositoryThread(
  hosts: ChatHosts,
  model: OrganizationPreferences,
  seed: Extract<ChatSeed, { kind: 'repository' }>,
): Promise<Chat> {
  const workspace = await hosts.workspaceFor(seed.repository)
  const threadId = randomUUID()
  const title = chatTitle(seed.title)
  await workspace.threads.startThread({
    threadId,
    projectId: workspace.project.id,
    title,
    model: engineModel(model),
    branch: null,
    worktreePath: null,
    message: seed.message(model.provider),
  })
  await workspace.open(threadId)
  return { threadId, title, project: workspace.project.title, location: workspace.location }
}

function chatTitle(title: string): string {
  return title.length <= MAX_TITLE_CHARACTERS
    ? title
    : `${title.slice(0, MAX_TITLE_CHARACTERS - 1).trimEnd()}…`
}

/** T3 Code's default provider instances for the two providers the reviewer supports. */
export function engineModel(model: OrganizationPreferences) {
  return {
    instanceId: model.provider === Provider.claude ? 'claudeAgent' : 'codex',
    model: model.model,
  }
}
