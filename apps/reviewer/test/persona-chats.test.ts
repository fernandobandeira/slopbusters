import { describe, expect, it, vi } from 'vitest'
import type { ChatHosts } from '../server/adapters/t3Engine/chatHosts'
import type { EngineThreadOperations } from '../server/adapters/t3Engine/engineThreads'
import type { ReviewSessions } from '../server/features/chat/chatSeeds'
import { continueInT3Code } from '../server/features/chat/personaChats'
import { UserError } from '../server/errors'
import type { BobSession } from '../shared/domain/bob'
import type { ContinueChatRequest } from '../shared/domain/chat'
import type { GandalfSession } from '../shared/domain/gandalf'
import type { JobsSession } from '../shared/domain/jobs'
import type { LinusSession } from '../shared/domain/linus'
import {
  bobSession,
  claude,
  codex,
  gandalfSession,
  jobsSession,
  linusAdvice,
  linusSession,
  pull,
} from './fixtures/chatSessions'
function sessionsWith(saved: {
  linus?: LinusSession
  bob?: BobSession
  jobs?: JobsSession
  gandalf?: GandalfSession
}): ReviewSessions {
  const find = <T extends { id: string }>(session: T | undefined) => ({
    get: vi.fn((id: string) => {
      if (session?.id !== id) throw new UserError('This review is no longer available.')
      return session
    }),
  })
  return {
    linus: find(saved.linus),
    bob: find(saved.bob),
    jobs: find(saved.jobs),
    gandalf: find(saved.gandalf),
  }
}

function fakeHosts() {
  const preparePullRequest = vi.fn().mockResolvedValue({
    branch: 'feature',
    worktreePath: '/engine/worktrees/feature',
    onPullRequestHead: true,
  })
  const startThread = vi.fn().mockResolvedValue(undefined)
  const open = vi.fn().mockResolvedValue(undefined)
  const threads = { preparePullRequest, startThread } as unknown as EngineThreadOperations
  const workspaceFor = vi.fn().mockResolvedValue({
    location: 'slopbusters',
    threads,
    project: { id: 'project-1', title: 'example', workspaceRoot: '/engine/repositories/example' },
    open,
  })
  const hosts: ChatHosts = { workspaceFor }
  const firstMessage = () => (startThread.mock.calls[0]?.[0] as { message: string }).message
  return { hosts, workspaceFor, preparePullRequest, startThread, open, firstMessage }
}

async function continueWith(
  saved: Parameters<typeof sessionsWith>[0],
  request: ContinueChatRequest,
  model = claude,
) {
  const host = fakeHosts()
  const chat = await continueInT3Code(host.hosts, {
    sessions: sessionsWith(saved),
    model,
    request,
  })
  return { ...host, chat }
}

describe('continuing a PR review in T3 Code', () => {
  it('opens a thread linked to the PR on a worktree of its head', async () => {
    const { chat, workspaceFor, preparePullRequest, startThread, open } = await continueWith(
      { linus: linusSession() },
      { persona: 'linus', sessionId: 'linus-1', url: pull.url },
    )

    expect(workspaceFor).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'review-room', repo: 'example' }),
    )
    expect(preparePullRequest).toHaveBeenCalledWith({
      cwd: '/engine/repositories/example',
      url: pull.url,
      threadId: chat.threadId,
    })
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: chat.threadId,
        projectId: 'project-1',
        title: 'Linus · #128 Require editor permissions for project updates',
        model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
        branch: 'feature',
        worktreePath: '/engine/worktrees/feature',
        pullRequest: {
          host: 'github.com',
          repository: 'review-room/example',
          number: 128,
          url: pull.url,
        },
      }),
    )
    expect(open).toHaveBeenCalledWith(chat.threadId)
    expect(chat).toMatchObject({
      project: 'example',
      location: 'slopbusters',
      onPullRequestHead: true,
    })
  })

  it('hands Linus his own review and waits for questions', async () => {
    const { firstMessage } = await continueWith(
      { linus: linusSession() },
      { persona: 'linus', sessionId: 'linus-1', url: pull.url },
    )

    const message = firstMessage()
    expect(message.startsWith(`/slopbusters:linus Use review-only mode for PR #128`)).toBe(true)
    expect(message).toContain('at head a7f239d')
    expect(message).toContain('**Verdict: Split into a stack**')
    expect(message).toContain('**Revised title:** Require editor permissions for project updates')
    expect(message).toContain('1. **Check editor role** (depends on: none).')
    expect(message).toContain('2. **Audit updates** (depends on: 1).')
    expect(message).toContain('- Two changes share one PR.')
    expect(message).toContain('- CI was not run.')
    expect(message.endsWith('Pick up from this review. Wait for my questions.')).toBe(true)
  })

  it('invokes the skill the way Codex expects and points Uncle Bob at the diff', async () => {
    const { firstMessage, startThread } = await continueWith(
      { bob: bobSession() },
      { persona: 'unclebob', sessionId: 'bob-1' },
      codex,
    )

    const message = firstMessage()
    expect(message.startsWith('$slopbusters:unclebob Review PR #128')).toBe(true)
    expect(message).toContain('git diff origin/main...HEAD')
    expect(message).toContain('## Uncle Bob: Improvements to make')
    expect(message).toMatch(/\*\*Should fix: Reuse the audit helper\*\*\n\n`src\/[^`]+:\d+`/)
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ model: { instanceId: 'codex', model: 'gpt-5.5' } }),
    )
  })
})

describe('which review a PR chat continues', () => {
  it('continues a partial review from the reviewer that finished', async () => {
    const partial = linusSession({
      status: 'partial',
      results: [],
      pending: {
        pull,
        fingerprint: 'f',
        reviews: [
          { model: claude, error: 'Timed out.' },
          { model: codex, advice: { ...linusAdvice, reasoning: 'Only the companion finished.' } },
        ],
      },
    })

    const { firstMessage } = await continueWith(
      { linus: partial },
      { persona: 'linus', sessionId: 'linus-1', url: pull.url },
    )

    expect(firstMessage()).toContain('Only the companion finished.')
    expect(firstMessage()).toContain('One of the two reviewers did not finish')
  })

  it('refuses before preparing anything when the PR has no result yet', async () => {
    const host = fakeHosts()
    const running = linusSession({ status: 'running', results: [] })

    await expect(
      continueInT3Code(host.hosts, {
        sessions: sessionsWith({ linus: running }),
        model: claude,
        request: { persona: 'linus', sessionId: 'linus-1', url: pull.url },
      }),
    ).rejects.toThrow('Linus has not finished reviewing this PR yet.')
    expect(host.workspaceFor).not.toHaveBeenCalled()
  })

  it('clips a long review to the chat limit', async () => {
    const long = { ...linusAdvice, revisedDescription: 'x'.repeat(30_000) }

    const { firstMessage } = await continueWith(
      {
        linus: linusSession({ results: [{ pull, fingerprint: 'f', advice: long, reviewers: [] }] }),
      },
      { persona: 'linus', sessionId: 'linus-1', url: pull.url },
    )

    expect(firstMessage()).toContain('[Truncated at 20000 characters.]')
    expect(firstMessage().length).toBeLessThan(22_000)
  })

  it('tells the persona when the reused worktree is not at the PR head', async () => {
    const host = fakeHosts()
    host.preparePullRequest.mockResolvedValue({
      branch: 'feature',
      worktreePath: '/w',
      onPullRequestHead: false,
    })

    await continueInT3Code(host.hosts, {
      sessions: sessionsWith({ bob: bobSession() }),
      model: claude,
      request: { persona: 'unclebob', sessionId: 'bob-1' },
    })

    expect(host.firstMessage()).toContain('may not match the PR head')
  })
})

describe('continuing Gandalf in T3 Code', () => {
  it('reports what he did on the PR and what the session left, and never pushes', async () => {
    const { firstMessage, startThread } = await continueWith(
      { gandalf: gandalfSession() },
      { persona: 'gandalf', sessionId: 'gandalf-1', url: pull.url },
    )

    const message = firstMessage()
    expect(
      message.startsWith(
        'You are Gandalf. In Slopbusters you worked on the merge conflicts of PR #128',
      ),
    ).toBe(true)
    expect(message).toContain('**Task:** bring the PR up to date with its base branch')
    expect(message).toContain('**Result:** pushed 12345678 on top of a7f239d1 after 1 round')
    expect(message).toContain('- Primary, round 1: Kept both permission checks in canEditProject.')
    expect(message).toContain(
      '- Not finished in this session: https://github.com/review-room/example/pull/129',
    )
    expect(message).toContain('The session failed: The base moved again.')
    expect(message).toContain('Do not push')
    expect(message).not.toContain('slopbusters:')
    const start = startThread.mock.calls[0]?.[0] as { pullRequest: { number: number } }
    expect(start.pullRequest.number).toBe(128)
  })

  it('refuses a PR Gandalf has not finished', async () => {
    await expect(
      continueWith(
        { gandalf: gandalfSession() },
        {
          persona: 'gandalf',
          sessionId: 'gandalf-1',
          url: 'https://github.com/review-room/example/pull/129',
        },
      ),
    ).rejects.toThrow('Gandalf has not finished with this PR yet.')
  })
})

describe('continuing a Jobs review in T3 Code', () => {
  it('runs in the repository checkout without a worktree or linked PR', async () => {
    const { chat, workspaceFor, preparePullRequest, startThread } = await continueWith(
      { jobs: jobsSession() },
      { persona: 'jobs', sessionId: 'jobs-1' },
    )

    expect(workspaceFor).toHaveBeenCalledWith({ owner: 'review-room', repo: 'example' })
    expect(preparePullRequest).not.toHaveBeenCalled()
    const start = startThread.mock.calls[0]?.[0] as Record<string, unknown>
    expect(start).toMatchObject({ branch: null, worktreePath: null })
    expect(start.pullRequest).toBeUndefined()
    expect(chat.title).toBe('Jobs · ENG-7 Lock down project edits')
  })

  it('hands Jobs his findings, the answers given, open questions and the rewrite', async () => {
    const { firstMessage } = await continueWith(
      { jobs: jobsSession() },
      { persona: 'jobs', sessionId: 'jobs-1' },
      codex,
    )

    const message = firstMessage()
    expect(
      message.startsWith(
        '$slopbusters:jobs Use review-only mode for Linear issue ENG-7, "Lock down project edits": https://linear.app/example/issue/ENG-7',
      ),
    ).toBe(true)
    expect(message).toContain('do not change any files')
    expect(message).toContain('**Verdict: Needs work**')
    expect(message).toContain('**Blocking: No definition of done** Say what a user sees')
    expect(message).toContain('Who may edit? **Answer:** Editors and admins.')
    expect(message).toContain('**Scope:** Does this include archived projects?')
    expect(message).toContain('**Proposed rewrite:** Only editors can update projects')
    expect(message).toContain('```markdown\n## Job')
    expect(message.endsWith('Pick up from this review. Wait for my questions.')).toBe(true)
  })

  it('refuses an issue without a review or without a repository', async () => {
    await expect(
      continueWith(
        { jobs: jobsSession({ status: 'running', revisions: [] }) },
        { persona: 'jobs', sessionId: 'jobs-1' },
      ),
    ).rejects.toThrow('Steve Jobs has not finished reviewing this issue yet.')
    await expect(
      continueWith(
        { jobs: jobsSession({ repository: '' }) },
        { persona: 'jobs', sessionId: 'jobs-1' },
      ),
    ).rejects.toThrow('Choose the repository this issue belongs to first.')
  })
})
