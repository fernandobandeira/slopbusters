import { describe, expect, it, vi } from 'vitest'
import type {
  EngineProject,
  EngineThreadOperations,
} from '../server/adapters/t3Engine/engineThreads'
import { linusChatMessage, startLinusChat } from '../server/features/linus/linusChat'
import { Provider, type PullRequest } from '../shared/domain/types'

const pull = {
  id: 'snapshot-1',
  url: 'https://github.com/Example/Project/pull/42',
  owner: 'Example',
  repo: 'Project',
  number: 42,
  title: 'Store the source account number',
  baseBranch: 'main',
  headBranch: 'feature',
  headSha: 'abcdef1234567890',
} as PullRequest
const claude = { provider: Provider.claude, model: 'claude-opus-5-5' }
const matchingProject: EngineProject = {
  id: 'project-1',
  title: 'project',
  workspaceRoot: '/code/project',
  repository: 'github.com/example/project',
}

function fakeEngine(projects: EngineProject[]) {
  const preparePullRequest = vi.fn().mockResolvedValue({
    branch: 'feature',
    worktreePath: '/home/user/.t3/worktrees/project/feature',
    onPullRequestHead: true,
  })
  const startThread = vi.fn().mockResolvedValue(undefined)
  const reveal = vi.fn().mockResolvedValue(undefined)
  const engine: EngineThreadOperations = {
    projects: () => Promise.resolve(projects),
    preparePullRequest,
    startThread,
    reveal,
  }
  return { engine, preparePullRequest, startThread, reveal }
}

describe('starting a Linus chat', () => {
  it('opens a linked thread in the checkout whose repository matches the PR', async () => {
    const other = { ...matchingProject, id: 'other', repository: 'github.com/a/b' }
    const { engine, preparePullRequest, startThread, reveal } = fakeEngine([other, matchingProject])

    const chat = await startLinusChat(engine, pull, claude)

    expect(preparePullRequest).toHaveBeenCalledWith({
      cwd: '/code/project',
      url: pull.url,
      threadId: chat.threadId,
    })
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: chat.threadId,
        projectId: 'project-1',
        title: 'Linus · #42 Store the source account number',
        model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
        branch: 'feature',
        worktreePath: '/home/user/.t3/worktrees/project/feature',
        pullRequest: {
          host: 'github.com',
          repository: 'Example/Project',
          number: 42,
          url: pull.url,
        },
      }),
    )
    expect(reveal).toHaveBeenCalled()
    expect(chat).toMatchObject({ project: 'project', onPullRequestHead: true })
  })

  it('asks for the repository to be added to T3 Code when no project matches', async () => {
    const { engine, preparePullRequest } = fakeEngine([])

    await expect(startLinusChat(engine, pull, claude)).rejects.toThrow(
      'Add your Example/Project checkout as a project in T3 Code',
    )

    expect(preparePullRequest).not.toHaveBeenCalled()
  })
})

describe('the first Linus message', () => {
  it('invokes the skill the way each provider expects', () => {
    const prepared = { branch: 'feature', onPullRequestHead: true }

    const claudeMessage = linusChatMessage(pull, Provider.claude, prepared)
    const codexMessage = linusChatMessage(pull, Provider.codex, prepared)

    expect(claudeMessage.startsWith('/slopbusters:linus Use review-only mode for PR #42')).toBe(
      true,
    )
    expect(codexMessage.startsWith('$slopbusters:linus Use review-only mode for PR #42')).toBe(true)
    expect(claudeMessage).toContain('PR head (abcdef1) checked out on branch feature')
  })

  it('tells Linus when the reused worktree is not at the PR head', () => {
    const message = linusChatMessage(pull, Provider.codex, {
      branch: 'feature',
      onPullRequestHead: false,
    })

    expect(message).toContain('may not match the PR head abcdef1')
  })
})
