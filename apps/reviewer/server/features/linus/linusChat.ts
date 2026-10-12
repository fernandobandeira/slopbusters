import { randomUUID } from 'node:crypto'
import type {
  EngineProject,
  EngineThreadOperations,
  PreparedPullRequest,
} from '../../adapters/t3Engine/engineThreads'
import { UserError } from '../../errors'
import type { LinusChat } from '../../../shared/domain/linus'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { Provider, type PullRequest } from '../../../shared/domain/types'

const LINUS_SKILL = 'slopbusters:linus'
const MAX_TITLE_CHARACTERS = 80

/**
 * Open a conversation with Linus about a pull request in the user's T3 Code. The PR head is
 * checked out in its own worktree of the matching T3 Code project, the thread is linked to the
 * PR, and the first message invokes the Linus skill in review-only mode.
 */
export async function startLinusChat(
  engine: EngineThreadOperations,
  pull: PullRequest,
  model: OrganizationPreferences,
): Promise<LinusChat> {
  const project = await projectForPull(engine, pull)
  const threadId = randomUUID()
  const prepared = await engine.preparePullRequest({
    cwd: project.workspaceRoot,
    url: pull.url,
    threadId,
  })
  const title = chatTitle(pull)
  await engine.startThread({
    threadId,
    projectId: project.id,
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
    message: linusChatMessage(pull, model.provider, prepared),
  })
  await engine.reveal()
  return { threadId, title, project: project.title, onPullRequestHead: prepared.onPullRequestHead }
}

async function projectForPull(
  engine: EngineThreadOperations,
  pull: PullRequest,
): Promise<EngineProject> {
  const repository = `github.com/${pull.owner}/${pull.repo}`.toLowerCase()
  const project = (await engine.projects()).find((candidate) => candidate.repository === repository)
  if (!project)
    throw new UserError(
      `Add your ${pull.owner}/${pull.repo} checkout as a project in T3 Code, then try again.`,
    )
  return project
}

/** The first message. Claude Code expands a leading `/skill`; Codex reads `$skill` mentions. */
export function linusChatMessage(
  pull: PullRequest,
  provider: Provider,
  prepared: Pick<PreparedPullRequest, 'branch' | 'onPullRequestHead'>,
): string {
  const invocation = provider === Provider.claude ? `/${LINUS_SKILL}` : `$${LINUS_SKILL}`
  const checkout = prepared.onPullRequestHead
    ? `This worktree has the PR head (${pull.headSha.slice(0, 7)}) checked out on branch ${prepared.branch}.`
    : `This worktree is on branch ${prepared.branch}, but it kept local commits or changes and may not match the PR head ${pull.headSha.slice(0, 7)}; say so if that limits your review.`
  return [
    `${invocation} Use review-only mode for PR #${pull.number}, "${pull.title}": ${pull.url}`,
    `${checkout} It targets ${pull.baseBranch}.`,
    'Start with your verdict on the title, the description, and whether this should be one PR or a stack, with the reasons. Then wait for my questions.',
  ].join('\n\n')
}

function chatTitle(pull: PullRequest): string {
  const title = `Linus · #${pull.number} ${pull.title}`
  return title.length <= MAX_TITLE_CHARACTERS
    ? title
    : `${title.slice(0, MAX_TITLE_CHARACTERS - 1).trimEnd()}…`
}

/** T3 Code's default provider instances for the two providers the reviewer supports. */
function engineModel(model: OrganizationPreferences) {
  return {
    instanceId: model.provider === Provider.claude ? 'claudeAgent' : 'codex',
    model: model.model,
  }
}
